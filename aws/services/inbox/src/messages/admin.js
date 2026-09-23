import { randomBytes } from 'node:crypto'
import { NotFoundError, ValidationError } from '../errors.js'
import { allowedCategories, assertCategoryAllowed, orgName } from '../auth.js'
import { recordAudit } from '../audit.js'
import { notifyRecipients } from '../notify.js'
import { strings } from '../strings.js'

const VALID_STATUS = new Set(['read', 'unread'])
const VALID_BOX = new Set(['inbox', 'archived'])
const VALID_STATE = new Set(['open', 'pending', 'done'])
// A category is an email local-part (replies go out from `${category}@domain`),
// so it has to be a valid one.
const CATEGORY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

const capitalize = (s) =>
  typeof s === 'string' && s.length ? s[0].toUpperCase() + s.slice(1) : s

// Load a message AND enforce the caller's category scope. A scoped-out admin
// gets 404 (existence hidden) — this is the single choke point every
// message-/note-touching handler goes through.
const requireMessage = async (deps, org, messageId, claims) => {
  const message = await deps.db.getMessage({ org, messageId })
  if (!message) {
    throw new NotFoundError('MESSAGE_NOT_FOUND', `Message ${messageId} not found`)
  }
  assertCategoryAllowed(claims, org, message.category)
  return message
}

// Raw MIME for the debug panel. Returns the raw message as text so the client
// can download it as an .eml file. Outbound rows have no S3 object.
export const raw = async ({ deps, org, pathParameters, claims }) => {
  const messageId = pathParameters?.messageId
  const message = await requireMessage(deps, org, messageId, claims)
  if (!message.s3Key) {
    throw new NotFoundError('NO_RAW', 'No raw MIME for this message')
  }
  const buf = await deps.mailStore.fetchRaw({
    bucket: message.s3Bucket,
    key: message.s3Key
  })
  return { raw: buf.toString('utf8'), filename: `${messageId}.eml` }
}

// A Lambda response may not exceed 6 MB, and base64 inflates by a third, so
// anything past this can't ride the JSON response — it goes out as a presigned
// S3 URL instead.
const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024

// One attachment's bytes for the reader's download button, base64 in JSON: the
// router speaks JSON only, and the client needs the Authorization header on the
// request, so a plain <a href> to a binary endpoint was never an option.
export const attachment = async ({ deps, org, pathParameters, claims }) => {
  const messageId = pathParameters?.messageId
  const index = Number(pathParameters?.index)
  if (!Number.isInteger(index) || index < 0) {
    throw new ValidationError(
      'ATTACHMENT_INDEX_INVALID',
      'Attachment index must be a non-negative integer'
    )
  }
  const message = await requireMessage(deps, org, messageId, claims)
  if (!message.s3Key) {
    throw new NotFoundError('NO_RAW', 'No raw MIME for this message')
  }
  const found = await deps.mailStore.fetchAttachment({
    bucket: message.s3Bucket,
    key: message.s3Key,
    index
  })
  if (!found) {
    throw new NotFoundError(
      'ATTACHMENT_NOT_FOUND',
      `No attachment ${index} on message ${messageId}`
    )
  }
  // Mail without a filename still has to save as something.
  const filename = found.filename || `bilaga-${index + 1}`
  if (found.size > ATTACHMENT_MAX_BYTES) {
    // Too big for the JSON round trip: hand out a presigned S3 URL and let the
    // browser fetch the bytes straight from S3.
    const url = await deps.mailStore.presignAttachment({
      bucket: message.s3Bucket,
      key: `attachments/${messageId}/${index}/${filename.replace(/[^\w.-]+/g, '_')}`,
      filename,
      contentType: found.contentType,
      content: found.content
    })
    return { filename, contentType: found.contentType, size: found.size, url }
  }
  return {
    filename,
    contentType: found.contentType,
    size: found.size,
    contentBase64: found.content.toString('base64')
  }
}

export const list = async ({ deps, org, query = {}, claims }) => {
  const box = VALID_BOX.has(query.box) ? query.box : 'inbox'
  let messages = await deps.db.listMessagesByBox({ org, box })
  // One row per thread: show only roots; replies (inbound or outbound) live
  // inside the thread. Legacy rows without threadId fall back to root.
  messages = messages.filter((m) => (m.threadId || m.messageId) === m.messageId)
  // Server-side category scoping — never return rows the caller can't see.
  const allowed = allowedCategories(claims, org)
  if (allowed !== '*') {
    const set = new Set(allowed)
    messages = messages.filter((m) => set.has(m.category))
  }
  if (query.category) {
    return messages.filter((m) => m.category === query.category)
  }
  return messages
}

// Resolve one thread member's displayable body (outbound from stored text,
// inbound parsed from S3 on demand).
const resolveMember = async (deps, m) => {
  let body = { text: '', html: null, attachments: [] }
  if (m.direction === 'outbound' || !m.s3Key) {
    body = { text: m.bodyText || '', html: null, attachments: [] }
  } else {
    try {
      const parsed = await deps.mailStore.fetchAndParse({
        bucket: m.s3Bucket,
        key: m.s3Key
      })
      body = {
        text: parsed.text || '',
        html: parsed.html || null,
        attachments: parsed.attachments || []
      }
    } catch {
      body = { text: '', html: null, attachments: [] }
    }
  }
  return {
    messageId: m.messageId,
    direction: m.direction,
    from: m.from,
    // Email of the admin who sent this reply (outbound only); resolved to a
    // display name in detail().
    sentBy: m.sentBy,
    receivedAt: m.receivedAt,
    subject: m.subject,
    text: body.text,
    html: body.html,
    attachments: body.attachments
  }
}

// email -> admin display name for the org, used to label replies and notes by
// the admin who wrote them (falls back to the email when not found).
const adminNameMap = async (deps, org) => {
  const admins = await deps.db.listAdmins({ org })
  const map = {}
  for (const a of admins || []) {
    if (a?.email) map[String(a.email).toLowerCase()] = a.name || a.email
  }
  return map
}
const displayName = (map, email) =>
  email ? map[String(email).toLowerCase()] || email : undefined

export const detail = async ({ deps, org, pathParameters, claims }) => {
  const messageId = pathParameters?.messageId
  const message = await requireMessage(deps, org, messageId, claims)

  // The whole conversation (root + our replies), oldest first.
  const root = message.threadId || message.messageId
  const members = await deps.db.listThread({ org, threadId: root })
  const thread = await Promise.all(members.map((m) => resolveMember(deps, m)))

  let status = message.status
  if (status === 'unread') {
    await deps.db.updateMessageStatus({ org, messageId, status: 'read' })
    status = 'read'
  }

  const notes = await deps.db.listNotesByMessage({ org, messageId })

  // Label replies and notes with the writing admin's display name (resolved
  // here so historical rows that only stored an email also get a name).
  const names = await adminNameMap(deps, org)
  const threadNamed = thread.map((m) =>
    m.sentBy ? { ...m, sentByName: displayName(names, m.sentBy) } : m
  )
  const notesNamed = notes.map((n) => ({
    ...n,
    authorName: displayName(names, n.author)
  }))

  return { ...message, status, thread: threadNamed, notes: notesNamed }
}

export const updateStatus = async ({ deps, org, pathParameters, body, claims }) => {
  const messageId = pathParameters?.messageId
  const before = await requireMessage(deps, org, messageId, claims)

  const hasStatus = body && body.status !== undefined
  const hasBox = body && body.box !== undefined
  const hasState = body && body.state !== undefined
  const hasAssignee = body && body.assignee !== undefined
  if (!hasStatus && !hasBox && !hasState && !hasAssignee) {
    throw new ValidationError('PATCH_EMPTY', 'Provide status, box, state or assignee')
  }
  if (hasStatus && !VALID_STATUS.has(body.status)) {
    throw new ValidationError('STATUS_INVALID', 'status must be read or unread')
  }
  if (hasBox && !VALID_BOX.has(body.box)) {
    throw new ValidationError('BOX_INVALID', 'box must be inbox or archived')
  }
  if (hasState && !VALID_STATE.has(body.state)) {
    throw new ValidationError('STATE_INVALID', 'state must be open, pending or done')
  }
  if (hasAssignee && body.assignee !== null && typeof body.assignee !== 'string') {
    throw new ValidationError('ASSIGNEE_INVALID', 'assignee must be an email or null')
  }

  let updated
  let action = 'update'
  const meta = {}
  if (hasBox) {
    updated = await deps.db.setMessageBox({ org, messageId, box: body.box })
    action = body.box === 'archived' ? 'archive' : 'unarchive'
    meta.box = { from: before.box, to: body.box }
  }
  if (hasStatus) {
    updated = await deps.db.updateMessageStatus({ org, messageId, status: body.status })
    if (!hasBox) action = 'status'
    meta.status = { from: before.status, to: body.status }
  }
  if (hasState) {
    updated = await deps.db.setMessageState({ org, messageId, state: body.state })
    if (!hasBox && !hasStatus) action = 'state'
    meta.state = { from: before.state, to: body.state }
  }
  if (hasAssignee) {
    const assignee = body.assignee || null
    updated = await deps.db.setMessageAssignee({ org, messageId, assignee })
    if (!hasBox && !hasStatus && !hasState) action = 'assign'
    meta.assignee = { from: before.assignee || null, to: assignee }
  }

  await recordAudit(deps, {
    org,
    claims,
    action,
    targetType: 'message',
    targetId: messageId,
    targetLabel: before.subject || '',
    meta
  })

  // Notify the assignee when someone else assigns them an issue (best-effort;
  // never on self-assignment or when clearing the assignee).
  if (hasAssignee && body.assignee && body.assignee !== claims?.email) {
    await notifyAssignee(deps, { org, claims, message: before, assignee: body.assignee })
  }

  return updated
}

// Best-effort "you were assigned an issue" email to the assignee.
const notifyAssignee = async (deps, { org, claims, message, assignee }) => {
  if (!deps.ses?.sendNotification) return
  const t = strings()
  const root = message.threadId || message.messageId
  try {
    await deps.ses.sendNotification({
      to: assignee,
      orgName: orgName(claims, org),
      subject: t.assignedSubject(message.subject || ''),
      heading: t.assignedHeading,
      paragraphs: [
        t.assignedBody(claims?.name || claims?.email || t.someAdmin),
        message.subject ? t.subjectLine(message.subject) : null
      ].filter(Boolean),
      // Hash route: the web app serves message deep-links at /#/m/:id.
      ctaUrl: deps.webBaseUrl ? `${deps.webBaseUrl}/#/m/${root}` : undefined,
      ctaLabel: t.ctaOpenIssue
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('assignee notification failed', assignee, e?.message)
  }
}

// Best-effort: email the other responsible admins about activity on an issue.
// Recipients are the same set notified about new issues (every superadmin +
// scoped admins covering the category, honouring the notifyNewIssue opt-out),
// minus the admin who triggered it. `makeParagraphs(who)` builds the body once
// the actor's display name is resolved.
const notifyColleagues = async (
  deps,
  { org, claims, category, root, subject, heading, makeParagraphs }
) => {
  if (!deps.ses?.sendNotification) return
  let admins
  try {
    admins = await deps.db.listAdmins({ org })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('colleague notification: admin lookup failed', org, e?.message)
    return
  }
  const actor = String(claims?.email || '').toLowerCase()
  const recipients = notifyRecipients(admins, category).filter(
    (email) => email !== actor
  )
  if (!recipients.length) return
  // The display name isn't in the JWT, so resolve it from the admin record
  // (same source the thread view uses); fall back to any claim name, then email.
  const actorAdmin = admins.find(
    (a) => String(a?.email || '').toLowerCase() === actor
  )
  const who = actorAdmin?.name || claims?.name || claims?.email || strings().someAdmin
  const club = orgName(claims, org)
  const paragraphs = makeParagraphs(who)
  for (const to of recipients) {
    try {
      await deps.ses.sendNotification({
        to,
        orgName: club,
        subject,
        heading,
        paragraphs,
        // Hash route: the web app serves message deep-links at /#/m/:id.
        ctaUrl: deps.webBaseUrl ? `${deps.webBaseUrl}/#/m/${root}` : undefined,
        ctaLabel: strings().ctaOpenIssue
      })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('colleague notification send failed', to, e?.message)
    }
  }
}

// A colleague replied to the member — tell the other responsible admins.
const notifyReplyColleagues = (deps, { org, claims, original }) =>
  notifyColleagues(deps, {
    org,
    claims,
    category: original.category,
    root: original.threadId || original.messageId,
    subject: strings().replySubject(original.subject || ''),
    heading: strings().replyHeading,
    makeParagraphs: (who) =>
      [
        strings().replyBody(who),
        original.subject ? strings().subjectLine(original.subject) : null
      ].filter(Boolean)
  })

// An issue was moved here — tell the RECEIVING category's admins (the old
// category's admins deliberately get nothing; the issue simply leaves them).
const notifyTransferColleagues = (deps, { org, claims, message, root, from, to }) =>
  notifyColleagues(deps, {
    org,
    claims,
    category: to,
    root,
    subject: strings().transferSubject(to, message.subject || ''),
    heading: strings().transferHeading,
    makeParagraphs: (who) =>
      [
        strings().transferBody(who, from, to),
        message.subject ? strings().subjectLine(message.subject) : null
      ].filter(Boolean)
  })

// A colleague added an internal note — tell the other responsible admins and
// include the full note text in the body.
const notifyNoteColleagues = (deps, { org, claims, message, text }) =>
  notifyColleagues(deps, {
    org,
    claims,
    category: message.category,
    root: message.threadId || message.messageId,
    subject: strings().noteSubject(message.subject || ''),
    heading: strings().noteHeading,
    makeParagraphs: (who) =>
      [
        strings().noteBody(who),
        message.subject ? strings().subjectLine(message.subject) : null,
        text
      ].filter(Boolean)
  })

// Permanently delete a whole thread (issue + all replies + notes). Guarded:
// the message must be archived first, and the caller's category scope applies.
export const remove = async ({ deps, org, pathParameters, claims }) => {
  const messageId = pathParameters?.messageId
  const message = await requireMessage(deps, org, messageId, claims)
  if (message.box !== 'archived') {
    throw new ValidationError('NOT_ARCHIVED', 'Archive the message before deleting it')
  }
  const root = message.threadId || message.messageId
  await deps.db.deleteThread({ org, threadId: root })
  await recordAudit(deps, {
    org,
    claims,
    action: 'delete',
    targetType: 'message',
    targetId: root,
    targetLabel: message.subject || '',
    meta: { category: message.category }
  })
  return { statusCode: 204 }
}

// Move a whole thread to another category — the fix for mail sent to the wrong
// alias. Deliberately NOT guarded by assertCategoryAllowed on the TARGET: the
// point is to hand an issue to a team you are not on, after which it drops out
// of your own list. Only the source is scoped (via requireMessage).
export const transfer = async ({ deps, org, pathParameters, body, claims }) => {
  const messageId = pathParameters?.messageId
  const to = String(body?.category || '').trim().toLowerCase()
  if (!CATEGORY_RE.test(to)) {
    throw new ValidationError('CATEGORY_INVALID', 'Ogiltig kategori')
  }
  const message = await requireMessage(deps, org, messageId, claims)
  const from = message.category
  const root = message.threadId || message.messageId

  // Comparing every member, not just the root, keeps a retry after a partially
  // written thread legal — it repairs the mixed state instead of 400ing.
  const members = await deps.db.listThread({ org, threadId: root })
  if (members.every((m) => m.category === to)) {
    throw new ValidationError('CATEGORY_UNCHANGED', strings().categoryUnchanged)
  }

  await deps.db.setThreadCategory({ org, threadId: root, category: to })

  // The note is the durable record, so it goes in before the best-effort mail.
  // Written as an ordinary note by the acting admin — no system-note concept.
  const author = claims?.email || claims?.name || strings().unknownAuthor
  const me = await deps.db.getAdmin({ org, email: author })
  const who = me?.name || claims?.name || claims?.email || strings().someAdmin
  await deps.db.putNote({
    org,
    note: {
      messageId: root,
      text: strings().transferNote(from, to, who),
      author
    }
  })

  await recordAudit(deps, {
    org,
    claims,
    action: 'transfer',
    targetType: 'message',
    targetId: root,
    targetLabel: message.subject || '',
    meta: { category: { from, to } }
  })

  await notifyTransferColleagues(deps, { org, claims, message, root, from, to })

  return { ...message, category: to, assignee: null }
}

// The org's known categories, for the transfer picker. Not category-scoped:
// these are just names, and picking a category you cannot see is the feature.
// Admin rows are unioned in so a category that has never received mail (a fresh
// alias) is still offerable.
export const listCategories = async ({ deps, org }) => {
  const [fromMessages, admins] = await Promise.all([
    deps.db.listMessageCategories({ org }),
    deps.db.listAdmins({ org })
  ])
  const all = new Set(fromMessages)
  for (const a of admins) {
    for (const c of a.categories || []) all.add(c)
  }
  return [...all].sort((a, b) => a.localeCompare(b, 'sv'))
}

export const addNote = async ({ deps, org, pathParameters, body, claims }) => {
  const messageId = pathParameters?.messageId
  const message = await requireMessage(deps, org, messageId, claims)
  if (!body || typeof body.text !== 'string' || body.text.trim().length === 0) {
    throw new ValidationError('NOTE_TEXT_REQUIRED', 'Note text required')
  }
  const author = claims?.email || claims?.name || strings().unknownAuthor
  const note = await deps.db.putNote({
    org,
    note: { messageId, text: body.text, author }
  })
  await recordAudit(deps, {
    org,
    claims,
    action: 'note',
    targetType: 'message',
    targetId: messageId,
    targetLabel: message.subject || ''
  })
  // Let the other responsible admins know, with the full note text (best-effort).
  await notifyNoteColleagues(deps, { org, claims, message, text: body.text })
  // Resolve the author's display name so the optimistic UI append shows a name
  // (detail() resolves it the same way on reload).
  const me = await deps.db.getAdmin({ org, email: author })
  return { statusCode: 201, data: { ...note, authorName: me?.name || author } }
}

const generateId = () => {
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `reply-${ts}-${randomBytes(4).toString('hex')}`
}

// Which of a message's recipients is one of ours, as a bare lowercase domain.
// `to` carries whatever the sender put there - display names, people cc-ed,
// addresses at domains we have never owned - so only a configured domain is
// ever returned. Without configured domains this yields nothing and the caller
// keeps its previous behaviour.
const addressedDomain = (to, mailDomains) => {
  const ours = (mailDomains || []).map((d) => String(d).trim().toLowerCase()).filter(Boolean)
  if (!ours.length) return null
  for (const entry of Array.isArray(to) ? to : [to]) {
    const address = String(entry || '').match(/<([^>]*)>/)?.[1] ?? String(entry || '')
    const domain = address.split('@')[1]?.trim().toLowerCase()
    if (domain && ours.includes(domain)) return domain
  }
  return null
}

export const reply = async ({ deps, org, pathParameters, body, claims }) => {
  const messageId = pathParameters?.messageId
  const original = await requireMessage(deps, org, messageId, claims)

  if (!body || typeof body.body !== 'string' || body.body.trim().length === 0) {
    throw new ValidationError('REPLY_BODY_REQUIRED', 'Reply body required')
  }

  const subject = body.subject || `Re: ${original.subject || ''}`
  const to = original.from

  // Reply from the category alias so the recipient's reply threads back to the
  // same inbox (kurser@ -> category kurser). Display name names the club + category.
  const senderDomain = String(deps.sender || '').split('@')[1]
  const category = original.category
  // Answer from the domain they actually wrote to. An environment can receive
  // on several domains, and being answered from a different one than you
  // addressed reads as a different company - or as phishing. Safe because SES
  // only accepts inbound mail for a VERIFIED identity, so every domain we can
  // receive on is one we may legitimately send as.
  const fromDomain = addressedDomain(original.to, deps.mailDomains) || senderDomain
  const fromAddress =
    category && fromDomain ? `${category}@${fromDomain}` : deps.sender
  // Club display name comes from the signed tenant claim (same source as admin
  // notifications), so the master serves any club with nothing hardcoded.
  const clubName = orgName(claims, org)
  const fromName = category ? `${clubName} - ${capitalize(category)}` : clubName
  const fromHeader = `${fromName} <${fromAddress}>`
  // Member-facing footer links to the club's public site (derived from the
  // sending domain, so it works per-org without extra config).
  const website = senderDomain ? `https://www.${senderDomain}` : undefined

  // Thread the outgoing mail to the original's real RFC Message-ID so the
  // recipient's client builds a proper References chain.
  const sent = await deps.ses.sendReply({
    to,
    subject,
    body: body.body,
    inReplyTo: original.mailMessageId || original.messageId,
    fromName,
    fromAddress,
    orgName: clubName,
    website
  })

  // Record SES's assigned Message-ID so a reply to THIS mail (In-Reply-To /
  // References that id) can be matched back to the thread on the way in.
  const region = process.env.AWS_REGION || 'eu-north-1'
  const mailMessageId = sent?.MessageId
    ? `<${sent.MessageId}@${region}.amazonses.com>`
    : undefined

  const outbound = {
    messageId: generateId(),
    category: original.category,
    from: fromHeader,
    to: [to],
    subject,
    receivedAt: new Date().toISOString(),
    status: 'read',
    direction: 'outbound',
    inReplyTo: original.messageId,
    threadId: original.threadId || original.messageId,
    bodyText: body.body,
    box: 'inbox',
    // Who actually sent this reply (the club/category is the visible From; this
    // names the admin behind it in the internal thread view).
    ...(claims?.email ? { sentBy: claims.email } : {}),
    ...(mailMessageId ? { mailMessageId } : {})
  }
  await deps.db.putMessage({ org, message: outbound })
  // A reply bumps the thread to the top of the list.
  await deps.db.bumpThreadActivity({
    org,
    rootId: original.threadId || original.messageId,
    ts: outbound.receivedAt
  })

  await recordAudit(deps, {
    org,
    claims,
    action: 'reply',
    targetType: 'message',
    targetId: original.messageId,
    targetLabel: original.subject || '',
    meta: { to }
  })

  // Auto-assign an unassigned issue to the replying admin (self-assign → no
  // email). The reply response carries the resulting assignee so the UI can
  // reflect it without a reload.
  const rootId = original.threadId || original.messageId
  let assignee = original.assignee || null
  const replier = claims?.email
  if (!assignee && replier) {
    await deps.db.setMessageAssignee({ org, messageId: rootId, assignee: replier })
    assignee = replier
    await recordAudit(deps, {
      org,
      claims,
      action: 'assign',
      targetType: 'message',
      targetId: rootId,
      targetLabel: original.subject || '',
      meta: { assignee: { from: null, to: replier, auto: true } }
    })
  }

  // Let the other responsible admins know a colleague replied (best-effort).
  await notifyReplyColleagues(deps, { org, claims, original })

  return { statusCode: 201, data: { ...outbound, assignee } }
}

// Org admins available as assignees (any inbox admin may assign to a colleague).
export const listAssignees = async ({ deps, org }) => {
  const admins = await deps.db.listAdmins({ org })
  return admins
    .filter((a) => a.active !== false)
    .map((a) => ({ email: a.email, name: a.name || a.email }))
}

// Whole-org search over thread roots, scoped to the caller's categories.
export const search = async ({ deps, org, query = {}, claims }) => {
  const results = await deps.db.searchMessages({ org, q: query.q })
  const allowed = allowedCategories(claims, org)
  if (allowed === '*') return results
  const set = new Set(allowed)
  return results.filter((m) => set.has(m.category))
}
