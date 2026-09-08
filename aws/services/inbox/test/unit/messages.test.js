import { describe, it, expect, beforeEach } from 'vitest'
import { FakeDocClient } from '../helper/fake-doc-client.js'
import { FakeSes } from '../helper/fake-ses.js'
import { FakeMailStore } from '../helper/fake-mail-store.js'
import { Database } from '../../src/database.js'
import {
  list,
  detail,
  updateStatus,
  reply,
  raw,
  attachment,
  addNote,
  remove,
  search,
  listAssignees,
  transfer,
  listCategories
} from '../../src/messages/admin.js'

const ORG = 'acme'
const SENDER = 'support@acme.example'

// Mirrors the pretoken claim: the club display name rides in orgs[org].name.
const CLAIMS = {
  orgs: JSON.stringify({
    [ORG]: {
      name: 'Acme Ltd',
      categories: '*',
      capabilities: { inbox: { read: true, write: true, send: true } },
      active: true
    }
  })
}

const baseMessage = (overrides = {}) => ({
  messageId: 'm1',
  category: 'kurser',
  from: 'Anna <anna@example.se>',
  to: ['kurser@acme.example'],
  subject: 'Fraga om kurs',
  receivedAt: '2026-06-01T10:00:00Z',
  status: 'unread',
  direction: 'inbound',
  box: 'inbox',
  s3Bucket: 'inbox-bucket',
  s3Key: 'inbound/m1',
  ...overrides
})

const makeDeps = () => {
  const docClient = new FakeDocClient()
  const db = new Database({ docClient, tableName: 'inbox-test' })
  const ses = new FakeSes()
  const mailStore = new FakeMailStore()
  return {
    db,
    ses,
    mailStore,
    sender: SENDER,
    webBaseUrl: 'https://dev.inbox.apps.acme.example',
    docClient
  }
}

describe('messages.list', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  it('lists inbox messages newest-first by default', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage({ messageId: 'old', receivedAt: '2026-05-01T00:00:00Z' }) })
    await deps.db.putMessage({ org: ORG, message: baseMessage({ messageId: 'new', receivedAt: '2026-06-01T00:00:00Z' }) })
    const res = await list({ deps, org: ORG, query: {} })
    expect(res.map((m) => m.messageId)).toEqual(['new', 'old'])
  })

  it('a reply bumps its thread to the top of the list', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage({ messageId: 'old', from: 'Anna <a@x.se>', receivedAt: '2026-05-01T00:00:00Z' }) })
    await deps.db.putMessage({ org: ORG, message: baseMessage({ messageId: 'new', receivedAt: '2026-06-01T00:00:00Z' }) })
    await reply({ deps, org: ORG, pathParameters: { messageId: 'old' }, body: { body: 'svar' }, claims: {} })
    const res = await list({ deps, org: ORG, query: {} })
    expect(res.map((m) => m.messageId)).toEqual(['old', 'new'])
  })

  it('shows only thread roots — outbound and inbound replies live in the thread', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage({ messageId: 'root' }) })
    await deps.db.putMessage({
      org: ORG,
      message: baseMessage({ messageId: 'r1', direction: 'outbound', inReplyTo: 'root', threadId: 'root' })
    })
    // an inbound reply from the sender, threaded to the same root
    await deps.db.putMessage({
      org: ORG,
      message: baseMessage({ messageId: 'r2', direction: 'inbound', inReplyTo: 'root', threadId: 'root' })
    })
    const res = await list({ deps, org: ORG, query: {} })
    expect(res.map((m) => m.messageId)).toEqual(['root'])
  })

  it('filters by category', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage({ messageId: 'a', category: 'kurser' }) })
    await deps.db.putMessage({ org: ORG, message: baseMessage({ messageId: 'b', category: 'styrelse' }) })
    const res = await list({ deps, org: ORG, query: { category: 'styrelse' } })
    expect(res.map((m) => m.messageId)).toEqual(['b'])
  })

  it('lists archived box when requested', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage({ messageId: 'arch', box: 'archived' }) })
    const inbox = await list({ deps, org: ORG, query: {} })
    const archived = await list({ deps, org: ORG, query: { box: 'archived' } })
    expect(inbox).toHaveLength(0)
    expect(archived.map((m) => m.messageId)).toEqual(['arch'])
  })
})

describe('messages.search + listAssignees', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  it('search matches by subject and is category-scoped', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage({ messageId: 'k', subject: 'Valpkurs', category: 'kurser' }) })
    await deps.db.putMessage({ org: ORG, message: baseMessage({ messageId: 's', subject: 'Valpmöte', category: 'styrelse' }) })
    const superHits = await search({ deps, org: ORG, query: { q: 'valp' }, claims: { orgs: JSON.stringify({ [ORG]: { categories: '*' } }) } })
    expect(superHits.map((m) => m.messageId).sort()).toEqual(['k', 's'])
    const scopedHits = await search({ deps, org: ORG, query: { q: 'valp' }, claims: { orgs: JSON.stringify({ [ORG]: { categories: ['kurser'] } }) } })
    expect(scopedHits.map((m) => m.messageId)).toEqual(['k'])
  })

  it('listAssignees returns org admins as {email,name}', async () => {
    await deps.db.putAdmin({ org: ORG, admin: { email: 'a@x.se', name: 'Anna', role: 'admin' } })
    await deps.db.putAdmin({ org: ORG, admin: { email: 'b@x.se', name: 'Bo', role: 'superadmin' } })
    const list = await listAssignees({ deps, org: ORG })
    expect(list).toEqual(
      expect.arrayContaining([
        { email: 'a@x.se', name: 'Anna' },
        { email: 'b@x.se', name: 'Bo' }
      ])
    )
  })
})

describe('messages.detail', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  it('fetches+parses the body from the mail store and marks read', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    deps.mailStore.seed({
      bucket: 'inbox-bucket',
      key: 'inbound/m1',
      parsed: { text: 'Hej!', html: null, attachments: [], from: 'anna@example.se' }
    })
    const res = await detail({ deps, org: ORG, pathParameters: { messageId: 'm1' } })
    expect(res.thread).toHaveLength(1)
    expect(res.thread[0].text).toBe('Hej!')
    expect(res.status).toBe('read')
    expect(res.notes).toEqual([])
    const stored = await deps.db.getMessage({ org: ORG, messageId: 'm1' })
    expect(stored.status).toBe('read')
  })

  it('includes internal notes in the detail response', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    deps.mailStore.seed({ bucket: 'inbox-bucket', key: 'inbound/m1', parsed: { text: 'x', html: null, attachments: [] } })
    await deps.db.putNote({ org: ORG, note: { messageId: 'm1', text: 'ring upp', author: 'a@x' } })
    const res = await detail({ deps, org: ORG, pathParameters: { messageId: 'm1' } })
    expect(res.notes.map((n) => n.text)).toEqual(['ring upp'])
  })

  it('throws NotFoundError for a missing message', async () => {
    await expect(
      detail({ deps, org: ORG, pathParameters: { messageId: 'nope' } })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('does not leak another org\'s message', async () => {
    await deps.db.putMessage({ org: 'otherorg', message: baseMessage() })
    await expect(
      detail({ deps, org: ORG, pathParameters: { messageId: 'm1' } })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('returns stored body for outbound messages without S3 fetch', async () => {
    await deps.db.putMessage({
      org: ORG,
      message: baseMessage({ messageId: 'out1', direction: 'outbound', s3Bucket: undefined, s3Key: undefined, bodyText: 'Svar', status: 'read' })
    })
    const res = await detail({ deps, org: ORG, pathParameters: { messageId: 'out1' } })
    expect(res.thread[0].text).toBe('Svar')
  })

  it('groups replies under the original as a thread', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    deps.mailStore.seed({ bucket: 'inbox-bucket', key: 'inbound/m1', parsed: { text: 'Hej!', html: null, attachments: [] } })
    // a sent reply (outbound, threaded to m1)
    await deps.db.putMessage({
      org: ORG,
      message: baseMessage({
        messageId: 'r1',
        direction: 'outbound',
        inReplyTo: 'm1',
        threadId: 'm1',
        bodyText: 'Vårt svar',
        s3Bucket: undefined,
        s3Key: undefined,
        receivedAt: '2026-06-01T12:00:00Z'
      })
    })
    const res = await detail({ deps, org: ORG, pathParameters: { messageId: 'm1' } })
    expect(res.thread.map((t) => t.direction)).toEqual(['inbound', 'outbound'])
    expect(res.thread[1].text).toBe('Vårt svar')
  })
})

describe('messages.updateStatus', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  it('marks read/unread', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    const res = await updateStatus({ deps, org: ORG, pathParameters: { messageId: 'm1' }, body: { status: 'read' } })
    expect(res.status).toBe('read')
  })

  it('archives by moving the box', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await updateStatus({ deps, org: ORG, pathParameters: { messageId: 'm1' }, body: { box: 'archived' } })
    const archived = await deps.db.listMessagesByBox({ org: ORG, box: 'archived' })
    expect(archived.map((m) => m.messageId)).toEqual(['m1'])
  })

  it('records an audit entry on archive (box from→to)', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await updateStatus({ deps, org: ORG, pathParameters: { messageId: 'm1' }, body: { box: 'archived' }, claims: { email: 'boss@x.se' } })
    const log = await deps.db.listAudit({ org: ORG })
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ action: 'archive', targetId: 'm1', actor: { email: 'boss@x.se' } })
    expect(log[0].meta.box).toEqual({ from: 'inbox', to: 'archived' })
  })

  it('rejects an invalid status', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await expect(
      updateStatus({ deps, org: ORG, pathParameters: { messageId: 'm1' }, body: { status: 'bogus' } })
    ).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('assigns + unassigns and audits it', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await updateStatus({ deps, org: ORG, pathParameters: { messageId: 'm1' }, body: { assignee: 'linn@x.se' }, claims: { email: 'boss@x.se' } })
    expect((await deps.db.getMessage({ org: ORG, messageId: 'm1' })).assignee).toBe('linn@x.se')
    const log = await deps.db.listAudit({ org: ORG })
    expect(log[0]).toMatchObject({ action: 'assign' })
    expect(log[0].meta.assignee).toEqual({ from: null, to: 'linn@x.se' })
  })

  it('emails the assignee when assigned by someone else (with a deep link)', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await updateStatus({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { assignee: 'linn@x.se' },
      claims: { email: 'boss@x.se', orgs: JSON.stringify({ [ORG]: { name: 'Acme BK' } }) }
    })
    expect(deps.ses.notifications).toHaveLength(1)
    const n = deps.ses.notifications[0]
    expect(n.to).toBe('linn@x.se')
    expect(n.orgName).toBe('Acme BK')
    expect(n.ctaUrl).toBe('https://dev.inbox.apps.acme.example/#/m/m1')
  })

  it('does not email on self-assignment', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await updateStatus({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { assignee: 'me@x.se' },
      claims: { email: 'me@x.se' }
    })
    expect(deps.ses.notifications).toHaveLength(0)
  })

  it('does not email when only clearing the assignee', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage({ assignee: 'linn@x.se' }) })
    await updateStatus({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { assignee: null },
      claims: { email: 'boss@x.se' }
    })
    expect(deps.ses.notifications).toHaveLength(0)
  })

  it('sets workflow state (open/pending/done)', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    const res = await updateStatus({ deps, org: ORG, pathParameters: { messageId: 'm1' }, body: { state: 'pending' } })
    expect(res.state).toBe('pending')
  })

  it('rejects an invalid state', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await expect(
      updateStatus({ deps, org: ORG, pathParameters: { messageId: 'm1' }, body: { state: 'bogus' } })
    ).rejects.toMatchObject({ name: 'ValidationError', code: 'STATE_INVALID' })
  })

  it('rejects an empty patch', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await expect(
      updateStatus({ deps, org: ORG, pathParameters: { messageId: 'm1' }, body: {} })
    ).rejects.toMatchObject({ name: 'ValidationError' })
  })
})

describe('messages.reply', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  it('sends a reply to the original sender and stores an outbound record', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    const res = await reply({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { body: 'Tack for din fraga!' },
      claims: CLAIMS
    })
    expect(res.statusCode).toBe(201)
    expect(deps.ses.replies).toHaveLength(1)
    expect(deps.ses.replies[0]).toMatchObject({
      to: 'Anna <anna@example.se>',
      subject: 'Re: Fraga om kurs',
      inReplyTo: 'm1',
      fromName: 'Acme Ltd - Kurser',
      fromAddress: 'kurser@acme.example'
    })
    const outbound = res.data
    expect(outbound.direction).toBe('outbound')
    expect(outbound.inReplyTo).toBe('m1')
    expect(outbound.threadId).toBe('m1')
    // SES Message-ID captured so inbound replies can thread back.
    expect(outbound.mailMessageId).toBe('<fake-reply-1@eu-north-1.amazonses.com>')
    // From display = club + capitalized category, sent from the category alias.
    expect(outbound.from).toBe(
      'Acme Ltd - Kurser <kurser@acme.example>'
    )
    const stored = await deps.db.getMessage({ org: ORG, messageId: outbound.messageId })
    expect(stored.bodyText).toBe('Tack for din fraga!')
    const log = await deps.db.listAudit({ org: ORG })
    expect(log[0]).toMatchObject({ action: 'reply', targetId: 'm1' })
  })

  it('records who sent the reply and detail resolves their display name', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'leader@acme.example', name: 'Patricia Gullberg', role: 'admin', active: true }
    })
    const claims = { ...CLAIMS, email: 'leader@acme.example' }
    const res = await reply({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { body: 'svar' },
      claims
    })
    expect(res.data.sentBy).toBe('leader@acme.example')
    const d = await detail({ deps, org: ORG, pathParameters: { messageId: 'm1' }, claims })
    const out = d.thread.find((m) => m.direction === 'outbound')
    expect(out.sentByName).toBe('Patricia Gullberg')
  })

  it('auto-assigns an unassigned issue to the replying admin (no email)', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    const res = await reply({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { body: 'Svar' },
      claims: { email: 'me@acme.example' }
    })
    expect(res.data.assignee).toBe('me@acme.example')
    const stored = await deps.db.getMessage({ org: ORG, messageId: 'm1' })
    expect(stored.assignee).toBe('me@acme.example')
    // self-assign → never notifies
    expect(deps.ses.notifications).toHaveLength(0)
    const log = await deps.db.listAudit({ org: ORG })
    const assign = log.find((l) => l.action === 'assign')
    expect(assign.meta.assignee).toEqual({ from: null, to: 'me@acme.example', auto: true })
  })

  it('notifies the other responsible admins on reply, excluding the replier', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() }) // category: kurser
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true }
    })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'kurs@acme.example', name: 'Kurs Ledare', role: 'admin', active: true, categories: ['kurser'] }
    })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'styr@acme.example', name: 'Styr', role: 'admin', active: true, categories: ['styrelse'] }
    })
    // No name in the JWT claims — it must be resolved from the admin record.
    await reply({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { body: 'Svar' },
      claims: { ...CLAIMS, email: 'kurs@acme.example' }
    })
    // Superadmin sees all categories → notified. The styrelse admin doesn't
    // cover kurser, and the replier (kurs ledare) is excluded.
    expect(deps.ses.notifications.map((n) => n.to)).toEqual(['boss@acme.example'])
    const n = deps.ses.notifications[0]
    expect(n.heading).toBe('Nytt svar i ett ärende')
    // Display name comes from the admin record, not the bare email.
    expect(n.paragraphs[0]).toBe('Kurs Ledare har svarat i ett ärende.')
    expect(n.ctaUrl).toBe('https://dev.inbox.apps.acme.example/#/m/m1')
  })

  it('skips reply notifications for admins who opted out (notifyNewIssue=false)', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true, notifyNewIssue: false }
    })
    await reply({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { body: 'Svar' },
      claims: { ...CLAIMS, email: 'kurs@acme.example', name: 'Kurs Ledare' }
    })
    expect(deps.ses.notifications).toHaveLength(0)
  })

  it('does not reassign an already-assigned issue on reply', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage({ assignee: 'linn@x.se' }) })
    const res = await reply({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { body: 'Svar' },
      claims: { email: 'me@acme.example' }
    })
    expect(res.data.assignee).toBe('linn@x.se')
    expect((await deps.db.getMessage({ org: ORG, messageId: 'm1' })).assignee).toBe('linn@x.se')
    const log = await deps.db.listAudit({ org: ORG })
    expect(log.some((l) => l.action === 'assign')).toBe(false)
  })

  it('honors a custom subject', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    const res = await reply({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { subject: 'Anpassad', body: 'Hej' }
    })
    expect(deps.ses.replies[0].subject).toBe('Anpassad')
    expect(res.data.subject).toBe('Anpassad')
  })

  it('rejects an empty reply body', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await expect(
      reply({ deps, org: ORG, pathParameters: { messageId: 'm1' }, body: { body: '  ' } })
    ).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('throws NotFoundError replying to a missing message', async () => {
    await expect(
      reply({ deps, org: ORG, pathParameters: { messageId: 'nope' }, body: { body: 'x' } })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })
})

describe('messages.raw', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  it('returns the raw MIME for download', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    deps.mailStore.seed({
      bucket: 'inbox-bucket',
      key: 'inbound/m1',
      raw: 'From: a@b\r\nSubject: x\r\n\r\nbody'
    })
    const res = await raw({ deps, org: ORG, pathParameters: { messageId: 'm1' } })
    expect(res.raw).toContain('Subject: x')
    expect(res.filename).toBe('m1.eml')
  })

  it('404s when the message has no raw object (outbound)', async () => {
    await deps.db.putMessage({
      org: ORG,
      message: baseMessage({ messageId: 'out', direction: 'outbound', s3Bucket: undefined, s3Key: undefined })
    })
    await expect(
      raw({ deps, org: ORG, pathParameters: { messageId: 'out' } })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('404s for a missing message', async () => {
    await expect(
      raw({ deps, org: ORG, pathParameters: { messageId: 'nope' } })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })
})

describe('messages.attachment', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  const seedWithAttachment = async (content = 'hello attachment') => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    deps.mailStore.seed({
      bucket: 'inbox-bucket',
      key: 'inbound/m1',
      parsed: {
        text: 'Se bifogad fil',
        html: null,
        attachments: [
          { filename: 'note.txt', contentType: 'text/plain', content }
        ]
      }
    })
  }

  it('returns the attachment base64-encoded so the client can save it', async () => {
    await seedWithAttachment()
    const res = await attachment({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1', index: '0' },
      claims: CLAIMS
    })
    expect(res.filename).toBe('note.txt')
    expect(res.contentType).toBe('text/plain')
    expect(Buffer.from(res.contentBase64, 'base64').toString('utf8')).toBe(
      'hello attachment'
    )
    expect(res.size).toBe('hello attachment'.length)
  })

  it('names an unnamed attachment so it can still be saved', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    deps.mailStore.seed({
      bucket: 'inbox-bucket',
      key: 'inbound/m1',
      parsed: {
        text: '',
        html: null,
        attachments: [{ filename: null, contentType: 'application/pdf', content: 'x' }]
      }
    })
    const res = await attachment({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1', index: '0' },
      claims: CLAIMS
    })
    expect(res.filename).toBe('bilaga-1')
  })

  it('404s for an index the message does not have', async () => {
    await seedWithAttachment()
    await expect(
      attachment({
        deps,
        org: ORG,
        pathParameters: { messageId: 'm1', index: '3' },
        claims: CLAIMS
      })
    ).rejects.toMatchObject({ name: 'NotFoundError', code: 'ATTACHMENT_NOT_FOUND' })
  })

  it('rejects a non-numeric index instead of fetching the whole mail', async () => {
    await seedWithAttachment()
    await expect(
      attachment({
        deps,
        org: ORG,
        pathParameters: { messageId: 'm1', index: 'evil' },
        claims: CLAIMS
      })
    ).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('hands out a presigned URL for an attachment too large for the JSON response', async () => {
    await seedWithAttachment('x'.repeat(5 * 1024 * 1024))
    const out = await attachment({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1', index: '0' },
      claims: CLAIMS
    })
    expect(out.url).toMatch(/^https:\/\/s3\.example\//)
    expect(out.contentBase64).toBeUndefined()
    expect(out.size).toBe(5 * 1024 * 1024)
  })

  it('404s when the raw mail is gone (lifecycle-expired or outbound)', async () => {
    await deps.db.putMessage({
      org: ORG,
      message: baseMessage({
        messageId: 'out',
        direction: 'outbound',
        s3Bucket: undefined,
        s3Key: undefined
      })
    })
    await expect(
      attachment({
        deps,
        org: ORG,
        pathParameters: { messageId: 'out', index: '0' },
        claims: CLAIMS
      })
    ).rejects.toMatchObject({ name: 'NotFoundError', code: 'NO_RAW' })
  })

  it('hides an attachment on a message outside the caller’s categories', async () => {
    await seedWithAttachment()
    const scoped = {
      orgs: JSON.stringify({
        [ORG]: {
          name: 'RBK',
          categories: ['styrelse'],
          capabilities: { inbox: { read: true } },
          active: true
        }
      })
    }
    await expect(
      attachment({
        deps,
        org: ORG,
        pathParameters: { messageId: 'm1', index: '0' },
        claims: scoped
      })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })
})

describe('messages.remove (hard delete)', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  it('deletes an archived thread (issue + replies + notes)', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage({ messageId: 'root', box: 'archived' }) })
    await deps.db.putMessage({ org: ORG, message: baseMessage({ messageId: 'rep', direction: 'outbound', threadId: 'root', inReplyTo: 'root', box: 'archived' }) })
    await deps.db.putNote({ org: ORG, note: { messageId: 'root', text: 'n', author: 'x' } })
    const res = await remove({ deps, org: ORG, pathParameters: { messageId: 'root' } })
    expect(res.statusCode).toBe(204)
    expect(await deps.db.getMessage({ org: ORG, messageId: 'root' })).toBeNull()
    expect(await deps.db.getMessage({ org: ORG, messageId: 'rep' })).toBeNull()
    const log = await deps.db.listAudit({ org: ORG })
    expect(log[0]).toMatchObject({ action: 'delete', targetId: 'root' })
  })

  it('refuses to delete a message that is not archived', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage({ box: 'inbox' }) })
    await expect(
      remove({ deps, org: ORG, pathParameters: { messageId: 'm1' } })
    ).rejects.toMatchObject({ name: 'ValidationError', code: 'NOT_ARCHIVED' })
  })

  it('404s for a missing message', async () => {
    await expect(
      remove({ deps, org: ORG, pathParameters: { messageId: 'nope' } })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })
})

describe('messages.addNote', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  it('stores an internal note from claims; never emails the member', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    const res = await addNote({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { text: 'Ring upp Anna imorgon' },
      claims: { email: 'leader@acme.example' }
    })
    expect(res.statusCode).toBe(201)
    expect(res.data).toMatchObject({ messageId: 'm1', text: 'Ring upp Anna imorgon', author: 'leader@acme.example' })
    // No member-facing reply, and no other admins exist to notify.
    expect(deps.ses.replies).toHaveLength(0)
    expect(deps.ses.notifications).toHaveLength(0)
    const notes = await deps.db.listNotesByMessage({ org: ORG, messageId: 'm1' })
    expect(notes).toHaveLength(1)
  })

  it('notifies the other responsible admins with the full note text', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() }) // category: kurser
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true }
    })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'leader@acme.example', name: 'Patricia Gullberg', role: 'admin', active: true, categories: ['kurser'] }
    })
    await addNote({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { text: 'Ring upp Anna imorgon kl 10.' },
      claims: { ...CLAIMS, email: 'leader@acme.example' }
    })
    // Superadmin notified; the author (Patricia) is excluded.
    expect(deps.ses.notifications.map((n) => n.to)).toEqual(['boss@acme.example'])
    const n = deps.ses.notifications[0]
    expect(n.heading).toBe('Ny intern anteckning')
    expect(n.paragraphs[0]).toBe('Patricia Gullberg har lagt till en intern anteckning.')
    // The complete note text is carried in the body.
    expect(n.paragraphs).toContain('Ring upp Anna imorgon kl 10.')
    expect(n.ctaUrl).toBe('https://dev.inbox.apps.acme.example/#/m/m1')
  })

  it('returns the author display name when the admin is known', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'leader@acme.example', name: 'Patricia Gullberg', role: 'admin', active: true }
    })
    const res = await addNote({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { text: 'klart' },
      claims: { email: 'leader@acme.example' }
    })
    expect(res.data).toMatchObject({ author: 'leader@acme.example', authorName: 'Patricia Gullberg' })
  })

  it('falls back to the email when no admin row exists', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    const res = await addNote({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { text: 'klart' },
      claims: { email: 'ghost@acme.example' }
    })
    expect(res.data.authorName).toBe('ghost@acme.example')
  })

  it('rejects an empty note', async () => {
    await deps.db.putMessage({ org: ORG, message: baseMessage() })
    await expect(
      addNote({ deps, org: ORG, pathParameters: { messageId: 'm1' }, body: { text: '  ' }, claims: {} })
    ).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('404s on a missing message', async () => {
    await expect(
      addNote({ deps, org: ORG, pathParameters: { messageId: 'nope' }, body: { text: 'x' }, claims: {} })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })
})

describe('messages.transfer', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  // Root + one reply, so every assertion also covers the thread members.
  const seedThread = async () => {
    await deps.db.putMessage({
      org: ORG,
      message: baseMessage({ assignee: 'linn@acme.example' })
    })
    await deps.db.putMessage({
      org: ORG,
      message: baseMessage({
        messageId: 'r1',
        threadId: 'm1',
        inReplyTo: 'm1',
        direction: 'outbound',
        bodyText: 'svar',
        receivedAt: '2026-06-02T10:00:00Z'
      })
    })
  }

  it('rewrites the category on every thread member and clears the assignee', async () => {
    await seedThread()
    const res = await transfer({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { category: 'agility' },
      claims: { ...CLAIMS, email: 'leader@acme.example' }
    })
    expect(res).toMatchObject({ messageId: 'm1', category: 'agility', assignee: null })
    const members = await deps.db.listThread({ org: ORG, threadId: 'm1' })
    expect(members.map((m) => m.category)).toEqual(['agility', 'agility'])
    expect(members.every((m) => m.assignee === null)).toBe(true)
  })

  it('works when started from a reply and moves the whole thread', async () => {
    await seedThread()
    await transfer({
      deps,
      org: ORG,
      pathParameters: { messageId: 'r1' },
      body: { category: 'agility' },
      claims: { ...CLAIMS, email: 'leader@acme.example' }
    })
    const members = await deps.db.listThread({ org: ORG, threadId: 'm1' })
    expect(members.map((m) => m.category)).toEqual(['agility', 'agility'])
  })

  it('posts an internal note naming both categories and the admin', async () => {
    await seedThread()
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'carina@acme.example', name: 'Carina', role: 'superadmin', active: true }
    })
    await transfer({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { category: 'agility' },
      claims: { ...CLAIMS, email: 'carina@acme.example' }
    })
    const notes = await deps.db.listNotesByMessage({ org: ORG, messageId: 'm1' })
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      messageId: 'm1',
      author: 'carina@acme.example',
      text: 'Ärendet flyttades från kurser till agility av Carina'
    })
  })

  it('records an audit entry with the category change', async () => {
    await seedThread()
    await transfer({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { category: 'agility' },
      claims: { ...CLAIMS, email: 'leader@acme.example' }
    })
    const log = await deps.db.listAudit({ org: ORG })
    const entry = log.find((l) => l.action === 'transfer')
    expect(entry.targetId).toBe('m1')
    expect(entry.meta.category).toEqual({ from: 'kurser', to: 'agility' })
  })

  it('notifies the new category subscribers only, excluding the actor', async () => {
    await seedThread()
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'agility@acme.example', name: 'Agility Anna', role: 'admin', active: true, categories: ['agility'] }
    })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'kurs@acme.example', name: 'Kurs Ledare', role: 'admin', active: true, categories: ['kurser'] }
    })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true, notifyNewIssue: false }
    })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'mover@acme.example', name: 'Mover', role: 'superadmin', active: true }
    })
    await transfer({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { category: 'agility' },
      claims: { ...CLAIMS, email: 'mover@acme.example' }
    })
    // Old category admin not told; opted-out superadmin skipped; actor excluded.
    expect(deps.ses.notifications.map((n) => n.to)).toEqual(['agility@acme.example'])
    const n = deps.ses.notifications[0]
    expect(n.heading).toBe('Ärende flyttat hit')
    expect(n.paragraphs[0]).toBe('Mover har flyttat ett ärende från kurser till agility.')
    expect(n.ctaUrl).toBe('https://dev.inbox.apps.acme.example/#/m/m1')
  })

  it('sends later replies from the new category alias', async () => {
    await seedThread()
    await transfer({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { category: 'agility' },
      claims: { ...CLAIMS, email: 'leader@acme.example' }
    })
    await reply({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1' },
      body: { body: 'Svar' },
      claims: CLAIMS
    })
    expect(deps.ses.replies[0]).toMatchObject({
      fromAddress: 'agility@acme.example',
      fromName: 'Acme Ltd - Agility'
    })
  })

  it('rejects a missing or malformed category', async () => {
    await seedThread()
    for (const category of [undefined, '', '  ', 'Inte Giltig!', 'a@b']) {
      await expect(
        transfer({
          deps,
          org: ORG,
          pathParameters: { messageId: 'm1' },
          body: { category },
          claims: CLAIMS
        })
      ).rejects.toMatchObject({ name: 'ValidationError', code: 'CATEGORY_INVALID' })
    }
  })

  it('rejects a transfer to the category the thread is already in', async () => {
    await seedThread()
    await expect(
      transfer({
        deps,
        org: ORG,
        pathParameters: { messageId: 'm1' },
        body: { category: 'KURSER' },
        claims: CLAIMS
      })
    ).rejects.toMatchObject({ name: 'ValidationError', code: 'CATEGORY_UNCHANGED' })
  })

  it('404s on a missing message', async () => {
    await expect(
      transfer({
        deps,
        org: ORG,
        pathParameters: { messageId: 'nope' },
        body: { category: 'agility' },
        claims: CLAIMS
      })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })
})

describe('messages.listCategories', () => {
  it('unions message categories with the categories on admin rows', async () => {
    const deps = makeDeps()
    await deps.db.putMessage({ org: ORG, message: baseMessage() }) // kurser
    await deps.db.putMessage({
      org: ORG,
      message: baseMessage({ messageId: 'm2', category: 'styrelsen' })
    })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'a@acme.example', name: 'A', role: 'admin', active: true, categories: ['agility', 'kurser'] }
    })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'b@acme.example', name: 'B', role: 'superadmin', active: true }
    })
    // Deduped, sorted, and includes a category that has no mail yet.
    expect(await listCategories({ deps, org: ORG })).toEqual([
      'agility',
      'kurser',
      'styrelsen'
    ])
  })
})
