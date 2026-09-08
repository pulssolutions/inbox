import { randomBytes } from 'node:crypto'
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb'
import { NotFoundError } from './errors.js'
import {
  tenantKey,
  messageKey,
  adminKey,
  noteKey,
  notePrefix,
  auditKey,
  messageGsi1Pk,
  messageGsi1Sk
} from './keys.js'


const stripInternal = (item) => {
  if (!item) return item
  const { pk, sk, gsi1pk, gsi1sk, ...rest } = item
  return rest
}

const nowIso = () => new Date().toISOString()

const buildMessageItem = ({ org, message }) => {
  const id = message.messageId
  const box = message.box || 'inbox'
  const receivedAt = message.receivedAt || nowIso()
  // The list (gsi1) sorts by lastActivityAt so a reply bumps the thread up.
  const lastActivityAt = message.lastActivityAt || receivedAt
  return {
    ...messageKey(org, id),
    gsi1pk: messageGsi1Pk(org, box),
    gsi1sk: messageGsi1Sk(lastActivityAt, id),
    ...message,
    messageId: id,
    box,
    receivedAt,
    lastActivityAt,
    state: message.state || 'open',
    // Root messages thread to themselves; replies inherit the root's threadId.
    threadId: message.threadId || id
  }
}

const buildAdminItem = ({ org, admin }) => {
  const email = String(admin.email).toLowerCase()
  return {
    ...adminKey(org, email),
    // Email GSI: reverse-lookup of every org a user belongs to (used by the
    // pretoken to build the multi-org claim).
    gsi1pk: `admin-email#${email}`,
    gsi1sk: org,
    active: true,
    addedAt: admin.addedAt || nowIso(),
    ...admin,
    email,
    org
  }
}

export class Database {
  constructor({ docClient, tableName }) {
    if (!docClient) throw new Error('docClient required')
    if (!tableName) throw new Error('tableName required')
    this.docClient = docClient
    this.tableName = tableName
  }

  // ---- internal helpers -------------------------------------------------

  async _put(item) {
    await this.docClient.send(
      new PutCommand({ TableName: this.tableName, Item: item })
    )
  }

  // Change named attributes on one message in a single conditional write.
  //
  // Replaces read-then-put-the-whole-row, which lost writes: two agents acting
  // on one ticket in the same second each read, each wrote back their own copy,
  // and whichever landed second silently reverted the other's field. This
  // touches only the named attributes, so concurrent changes to DIFFERENT
  // fields both survive - and it is one round trip instead of two.
  //
  // The condition also stops an update resurrecting a row deleted in between.
  async _updateMessage({ org, messageId, set }) {
    const names = {}
    const values = {}
    const assignments = []
    Object.entries(set).forEach(([attr, value], i) => {
      names[`#a${i}`] = attr
      values[`:v${i}`] = value
      assignments.push(`#a${i} = :v${i}`)
    })

    try {
      const res = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: messageKey(org, messageId),
          UpdateExpression: `SET ${assignments.join(', ')}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ConditionExpression: 'attribute_exists(pk)',
          ReturnValues: 'ALL_NEW'
        })
      )
      return stripInternal(res.Attributes)
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') {
        throw new NotFoundError('MESSAGE_NOT_FOUND', `Message ${messageId} not found`)
      }
      throw e
    }
  }

  async _get(key) {
    const res = await this.docClient.send(
      new GetCommand({ TableName: this.tableName, Key: key })
    )
    return res.Item ?? null
  }

  async _delete(key) {
    await this.docClient.send(
      new DeleteCommand({ TableName: this.tableName, Key: key })
    )
  }

  async _query({
    pkAttr,
    pkValue,
    indexName,
    scanForward = true,
    skBeginsWith,
    limit
  }) {
    const names = { '#pk': pkAttr }
    const values = { ':pk': pkValue }
    let expr = '#pk = :pk'
    if (skBeginsWith) {
      expr += ' AND begins_with(#sk, :skv)'
      names['#sk'] = indexName ? 'gsi1sk' : 'sk'
      values[':skv'] = skBeginsWith
    }
    const input = {
      TableName: this.tableName,
      KeyConditionExpression: expr,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ScanIndexForward: scanForward
    }
    if (indexName) input.IndexName = indexName
    if (limit) input.Limit = limit

    const items = []
    let lastKey
    do {
      if (lastKey) input.ExclusiveStartKey = lastKey
      const res = await this.docClient.send(new QueryCommand(input))
      for (const it of res.Items || []) items.push(it)
      lastKey = res.LastEvaluatedKey
      if (limit && items.length >= limit) break // bounded reads (e.g. audit)
    } while (lastKey)
    return limit ? items.slice(0, limit) : items
  }

  // ---- tenants (global ALL:tenant) -------------------------------------

  async putTenant({ domain, org, name }) {
    const sk = String(domain).toLowerCase()
    await this._put({
      ...tenantKey(sk),
      domain: sk,
      org,
      name: name ?? org
    })
  }

  async getTenant({ domain }) {
    const item = await this._get(tenantKey(domain))
    return stripInternal(item)
  }

  async listTenants() {
    const items = await this._query({ pkAttr: 'pk', pkValue: 'ALL:tenant' })
    return items.map(stripInternal)
  }

  // ---- messages ---------------------------------------------------------

  async putMessage({ org, message }) {
    await this._put(buildMessageItem({ org, message }))
  }

  async getMessage({ org, messageId }) {
    const item = await this._get(messageKey(org, messageId))
    return stripInternal(item)
  }

  async listMessagesByBox({ org, box = 'inbox' }) {
    const items = await this._query({
      pkAttr: 'gsi1pk',
      pkValue: messageGsi1Pk(org, box),
      indexName: 'gsi1',
      scanForward: false
    })
    return items.map(stripInternal)
  }

  async updateMessageStatus({ org, messageId, status }) {
    return this._updateMessage({ org, messageId, set: { status } })
  }

  // The box also decides which list partition the row appears in, so gsi1pk
  // moves with it.
  async setMessageBox({ org, messageId, box }) {
    return this._updateMessage({
      org,
      messageId,
      set: { box, gsi1pk: messageGsi1Pk(org, box) }
    })
  }

  async setMessageState({ org, messageId, state }) {
    return this._updateMessage({ org, messageId, set: { state } })
  }

  async setMessageAssignee({ org, messageId, assignee }) {
    return this._updateMessage({ org, messageId, set: { assignee: assignee || null } })
  }

  // Bump a thread's lastActivityAt (rewrites gsi1sk → list re-sorts to top).
  async bumpThreadActivity({ org, rootId, ts }) {
    const root = await this.getMessage({ org, messageId: rootId })
    if (!root) return
    await this.putMessage({ org, message: { ...root, lastActivityAt: ts || nowIso() } })
  }

  // Record that a reminder went out. Deliberately does NOT touch lastActivityAt —
  // the reminder sweep measures silence from that field, so bumping it here would
  // reset the job's own clock and no issue would ever be reminded twice.
  async setMessageNag({ org, messageId, count, at }) {
    const existing = await this.getMessage({ org, messageId })
    if (!existing) return null
    const next = { ...existing, nagCount: count, naggedAt: at }
    await this.putMessage({ org, message: next })
    return next
  }

  // Move a whole thread to another category. Every member carries its own
  // `category` (and `reply` derives the outgoing alias from it), so all of them
  // are rewritten — not just the root. The assignee is dropped in the same pass:
  // the issue is leaving that team. Bumping activity floats it to the top of the
  // receiving team's list instead of burying it at its original date.
  async setThreadCategory({ org, threadId, category }) {
    const members = await this.listThread({ org, threadId })
    for (const m of members) {
      await this.putMessage({ org, message: { ...m, category, assignee: null } })
    }
    await this.bumpThreadActivity({ org, rootId: threadId })
    return members.length
  }

  // Distinct categories in use on the org's messages (low volume → scan the
  // partition, same as searchMessages).
  async listMessageCategories({ org }) {
    const items = await this._query({ pkAttr: 'pk', pkValue: `${org}:message` })
    return [...new Set(items.map((m) => m.category).filter(Boolean))]
  }

  // Whole-org search over thread roots (low volume → scan the partition).
  // Category scoping is applied by the caller.
  async searchMessages({ org, q }) {
    const term = String(q || '').trim().toLowerCase()
    if (!term) return []
    const items = await this._query({ pkAttr: 'pk', pkValue: `${org}:message` })
    const haystack = (m) =>
      `${m.subject || ''} ${m.from || ''} ${m.category || ''}`.toLowerCase()
    return items
      .map(stripInternal)
      .filter((m) => (m.threadId || m.messageId) === m.messageId) // roots only
      .filter((m) => haystack(m).includes(term))
      .sort((a, b) =>
        (a.lastActivityAt || a.receivedAt || '') < (b.lastActivityAt || b.receivedAt || '')
          ? 1
          : -1
      )
  }

  // All messages in a thread (root + replies), oldest first. Matches by
  // threadId, with inReplyTo/messageId fallbacks for legacy rows written before
  // threadId existed. Low volume — scans the org's message partition.
  async listThread({ org, threadId }) {
    const items = await this._query({ pkAttr: 'pk', pkValue: `${org}:message` })
    return items
      .map(stripInternal)
      .filter(
        (m) =>
          m.threadId === threadId ||
          m.inReplyTo === threadId ||
          m.messageId === threadId
      )
      .sort((a, b) => ((a.receivedAt || '') < (b.receivedAt || '') ? -1 : 1))
  }

  // ---- internal notes ---------------------------------------------------

  async putNote({ org, note }) {
    const createdAt = note.createdAt || nowIso()
    await this._put({
      ...noteKey(org, note.messageId, createdAt),
      ...note,
      createdAt
    })
    return { ...note, createdAt }
  }

  async listNotesByMessage({ org, messageId }) {
    const items = await this._query({
      pkAttr: 'pk',
      pkValue: `${org}:note`,
      skBeginsWith: notePrefix(messageId)
    })
    return items.map(stripInternal)
  }

  // Permanently delete an entire thread: every message row in the thread plus
  // their internal notes. (Raw MIME in S3 expires via its own lifecycle rule.)
  async deleteThread({ org, threadId }) {
    const members = await this.listThread({ org, threadId })
    for (const m of members) {
      const notes = await this.listNotesByMessage({ org, messageId: m.messageId })
      for (const n of notes) {
        await this._delete(noteKey(org, m.messageId, n.createdAt))
      }
      await this._delete(messageKey(org, m.messageId))
    }
    return members.length
  }

  // ---- admins -----------------------------------------------------------

  async putAdmin({ org, admin }) {
    await this._put(buildAdminItem({ org, admin }))
  }

  async getAdmin({ org, email }) {
    const item = await this._get(adminKey(org, email))
    return stripInternal(item)
  }

  async listAdmins({ org }) {
    const items = await this._query({
      pkAttr: 'pk',
      pkValue: `${org}:admin`
    })
    return items.map(stripInternal)
  }

  async deleteAdmin({ org, email }) {
    await this._delete(adminKey(org, email))
  }

  // Every org a user is an admin of (via the email GSI). Used by the pretoken.
  async listAdminOrgsByEmail({ email }) {
    const items = await this._query({
      pkAttr: 'gsi1pk',
      pkValue: `admin-email#${String(email).toLowerCase()}`,
      indexName: 'gsi1'
    })
    return items.map(stripInternal)
  }

  // ---- audit log (append-only) -----------------------------------------

  async putAudit({ org, entry }) {
    const ts = entry.ts || nowIso()
    const id = randomBytes(4).toString('hex')
    await this._put({ ...auditKey(org, ts, id), ...entry, ts, id })
    return { ...entry, ts, id }
  }

  async listAudit({ org, limit = 200 }) {
    const items = await this._query({
      pkAttr: 'pk',
      pkValue: `${org}:audit`,
      scanForward: false, // newest first
      limit
    })
    return items.map(stripInternal)
  }
}
