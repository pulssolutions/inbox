import { describe, it, expect, beforeEach } from 'vitest'
import { FakeDocClient } from '../helper/fake-doc-client.js'
import { Database } from '../../src/database.js'

const ORG = 'acme'
const TABLE = 'inbox-test'

const baseMessage = (overrides = {}) => ({
  messageId: 'm1',
  category: 'kurser',
  from: 'Anna <anna@example.se>',
  to: ['kurser@acme.example'],
  subject: 'Fråga om kurs',
  receivedAt: '2026-06-01T10:00:00Z',
  status: 'unread',
  direction: 'inbound',
  s3Bucket: 'inbox-bucket',
  s3Key: 'inbound/m1',
  ...overrides
})

describe('Database tenants', () => {
  let docClient, db
  beforeEach(() => {
    docClient = new FakeDocClient()
    db = new Database({ docClient, tableName: TABLE })
  })

  it('putTenant stores a global ALL:tenant row keyed by domain', async () => {
    await db.putTenant({ domain: 'Acme.EXAMPLE', org: 'acme', name: 'Acme BK' })
    const stored = docClient.all()[0]
    expect(stored).toMatchObject({
      pk: 'ALL:tenant',
      sk: 'acme.example',
      domain: 'acme.example',
      org: 'acme',
      name: 'Acme BK'
    })
  })

  it('name defaults to org when omitted', async () => {
    await db.putTenant({ domain: 'x.se', org: 'x' })
    const t = await db.getTenant({ domain: 'x.se' })
    expect(t.name).toBe('x')
  })

  it('listTenants returns all tenant rows', async () => {
    await db.putTenant({ domain: 'a.se', org: 'a' })
    await db.putTenant({ domain: 'b.se', org: 'b' })
    const list = await db.listTenants()
    expect(list.map((t) => t.org).sort()).toEqual(['a', 'b'])
  })
})

describe('Database messages', () => {
  let docClient, db
  beforeEach(() => {
    docClient = new FakeDocClient()
    db = new Database({ docClient, tableName: TABLE })
  })

  it('putMessage stores composite + inbox GSI1 partition', async () => {
    await db.putMessage({ org: ORG, message: baseMessage() })
    const stored = docClient.all()[0]
    expect(stored).toMatchObject({
      pk: 'acme:message',
      sk: 'm1',
      gsi1pk: 'acme:message:inbox',
      gsi1sk: '2026-06-01T10:00:00Z#m1'
    })
  })

  it('listMessagesByBox returns inbox messages newest-first', async () => {
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'old', receivedAt: '2026-05-01T00:00:00Z' }) })
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'new', receivedAt: '2026-06-01T00:00:00Z' }) })
    const list = await db.listMessagesByBox({ org: ORG, box: 'inbox' })
    expect(list.map((m) => m.messageId)).toEqual(['new', 'old'])
  })

  it('getMessage strips internal keys', async () => {
    await db.putMessage({ org: ORG, message: baseMessage() })
    const m = await db.getMessage({ org: ORG, messageId: 'm1' })
    expect(m.pk).toBeUndefined()
    expect(m.gsi1pk).toBeUndefined()
    expect(m.subject).toBe('Fråga om kurs')
  })

  it('updateMessageStatus rewrites status, keeps other attrs', async () => {
    await db.putMessage({ org: ORG, message: baseMessage() })
    await db.updateMessageStatus({ org: ORG, messageId: 'm1', status: 'read' })
    const m = await db.getMessage({ org: ORG, messageId: 'm1' })
    expect(m.status).toBe('read')
    expect(m.from).toBe('Anna <anna@example.se>')
  })

  it('setMessageBox moves message to archived partition', async () => {
    await db.putMessage({ org: ORG, message: baseMessage() })
    await db.setMessageBox({ org: ORG, messageId: 'm1', box: 'archived' })
    const stored = docClient.all().find((it) => it.sk === 'm1')
    expect(stored.gsi1pk).toBe('acme:message:archived')
    const inbox = await db.listMessagesByBox({ org: ORG, box: 'inbox' })
    const archived = await db.listMessagesByBox({ org: ORG, box: 'archived' })
    expect(inbox).toHaveLength(0)
    expect(archived.map((m) => m.messageId)).toEqual(['m1'])
  })

  it('bumpThreadActivity reorders the list (newest activity first)', async () => {
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'old', receivedAt: '2026-05-01T00:00:00Z' }) })
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'new', receivedAt: '2026-06-01T00:00:00Z' }) })
    expect((await db.listMessagesByBox({ org: ORG, box: 'inbox' })).map((m) => m.messageId)).toEqual(['new', 'old'])
    await db.bumpThreadActivity({ org: ORG, rootId: 'old', ts: '2026-07-01T00:00:00Z' })
    expect((await db.listMessagesByBox({ org: ORG, box: 'inbox' })).map((m) => m.messageId)).toEqual(['old', 'new'])
  })

  it('setMessageAssignee sets and clears the assignee', async () => {
    await db.putMessage({ org: ORG, message: baseMessage() })
    await db.setMessageAssignee({ org: ORG, messageId: 'm1', assignee: 'linn@x.se' })
    expect((await db.getMessage({ org: ORG, messageId: 'm1' })).assignee).toBe('linn@x.se')
    await db.setMessageAssignee({ org: ORG, messageId: 'm1', assignee: null })
    expect((await db.getMessage({ org: ORG, messageId: 'm1' })).assignee).toBeNull()
  })

  it('searchMessages matches roots by subject/from/category, excludes replies', async () => {
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'a', subject: 'Valpkurs i höst' }) })
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'b', subject: 'Mötesprotokoll', category: 'styrelse' }) })
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'r', direction: 'outbound', threadId: 'a', inReplyTo: 'a', subject: 'Re: Valpkurs' }) })
    const hits = await db.searchMessages({ org: ORG, q: 'valpkurs' })
    expect(hits.map((m) => m.messageId)).toEqual(['a'])
  })

  it('updateMessageStatus throws NotFoundError when missing', async () => {
    await expect(
      db.updateMessageStatus({ org: ORG, messageId: 'nope', status: 'read' })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('isolates messages by org', async () => {
    await db.putMessage({ org: 'orgA', message: baseMessage({ messageId: 'a1' }) })
    await db.putMessage({ org: 'orgB', message: baseMessage({ messageId: 'b1' }) })
    const a = await db.listMessagesByBox({ org: 'orgA', box: 'inbox' })
    expect(a.map((m) => m.messageId)).toEqual(['a1'])
  })

  it('defaults threadId to messageId and listThread groups members', async () => {
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'root', receivedAt: '2026-06-01T09:00:00Z' }) })
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'rep', direction: 'outbound', inReplyTo: 'root', threadId: 'root', receivedAt: '2026-06-01T10:00:00Z' }) })
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'other', receivedAt: '2026-06-01T11:00:00Z' }) })
    expect((await db.getMessage({ org: ORG, messageId: 'root' })).threadId).toBe('root')
    const thread = await db.listThread({ org: ORG, threadId: 'root' })
    expect(thread.map((m) => m.messageId)).toEqual(['root', 'rep'])
  })

  it('defaults state to open and setMessageState updates it', async () => {
    await db.putMessage({ org: ORG, message: baseMessage() })
    expect((await db.getMessage({ org: ORG, messageId: 'm1' })).state).toBe('open')
    await db.setMessageState({ org: ORG, messageId: 'm1', state: 'done' })
    expect((await db.getMessage({ org: ORG, messageId: 'm1' })).state).toBe('done')
  })
})

describe('Database notes', () => {
  let db
  beforeEach(() => {
    db = new Database({ docClient: new FakeDocClient(), tableName: TABLE })
  })

  it('putNote stores under the message and listNotesByMessage returns them sorted', async () => {
    await db.putNote({ org: ORG, note: { messageId: 'm1', text: 'andra', author: 'a@x', createdAt: '2026-06-02T10:00:00Z' } })
    await db.putNote({ org: ORG, note: { messageId: 'm1', text: 'första', author: 'a@x', createdAt: '2026-06-01T10:00:00Z' } })
    await db.putNote({ org: ORG, note: { messageId: 'other', text: 'annan', author: 'a@x', createdAt: '2026-06-01T10:00:00Z' } })
    const notes = await db.listNotesByMessage({ org: ORG, messageId: 'm1' })
    expect(notes.map((n) => n.text)).toEqual(['första', 'andra'])
  })

  it('isolates notes by org', async () => {
    await db.putNote({ org: 'orgA', note: { messageId: 'm1', text: 'a', author: 'x' } })
    const b = await db.listNotesByMessage({ org: 'orgB', messageId: 'm1' })
    expect(b).toEqual([])
  })

  it('deleteThread removes every message + note in the thread', async () => {
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'root' }) })
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'rep', direction: 'outbound', threadId: 'root', inReplyTo: 'root' }) })
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'other' }) })
    await db.putNote({ org: ORG, note: { messageId: 'root', text: 'n', author: 'x' } })
    const n = await db.deleteThread({ org: ORG, threadId: 'root' })
    expect(n).toBe(2)
    expect(await db.getMessage({ org: ORG, messageId: 'root' })).toBeNull()
    expect(await db.getMessage({ org: ORG, messageId: 'rep' })).toBeNull()
    expect(await db.listNotesByMessage({ org: ORG, messageId: 'root' })).toEqual([])
    // unrelated message untouched
    expect(await db.getMessage({ org: ORG, messageId: 'other' })).not.toBeNull()
  })
})

describe('Database audit log', () => {
  let db
  beforeEach(() => {
    db = new Database({ docClient: new FakeDocClient(), tableName: TABLE })
  })

  it('putAudit stamps ts+id; listAudit returns newest-first', async () => {
    await db.putAudit({ org: ORG, entry: { action: 'reply', ts: '2026-06-01T10:00:00Z' } })
    await db.putAudit({ org: ORG, entry: { action: 'delete', ts: '2026-06-03T10:00:00Z' } })
    await db.putAudit({ org: ORG, entry: { action: 'note', ts: '2026-06-02T10:00:00Z' } })
    const log = await db.listAudit({ org: ORG })
    expect(log.map((e) => e.action)).toEqual(['delete', 'note', 'reply'])
    expect(log[0].id).toBeDefined()
  })

  it('isolates audit by org', async () => {
    await db.putAudit({ org: 'orgA', entry: { action: 'reply' } })
    expect(await db.listAudit({ org: 'orgB' })).toEqual([])
  })
})

describe('Database admins', () => {
  let db
  beforeEach(() => {
    db = new Database({ docClient: new FakeDocClient(), tableName: TABLE })
  })

  it('putAdmin lowercases email and defaults active', async () => {
    await db.putAdmin({ org: ORG, admin: { email: 'Anna@Example.SE' } })
    const a = await db.getAdmin({ org: ORG, email: 'anna@example.se' })
    expect(a.active).toBe(true)
    expect(a.email).toBe('anna@example.se')
  })

  it('listAdmins returns org admins', async () => {
    await db.putAdmin({ org: ORG, admin: { email: 'a@x.se' } })
    await db.putAdmin({ org: ORG, admin: { email: 'b@x.se' } })
    const list = await db.listAdmins({ org: ORG })
    expect(list).toHaveLength(2)
  })
})

describe('Database thread category', () => {
  let db
  beforeEach(async () => {
    db = new Database({ docClient: new FakeDocClient(), tableName: TABLE })
    await db.putMessage({
      org: ORG,
      message: baseMessage({ assignee: 'linn@x.se', lastActivityAt: '2026-06-01T10:00:00Z' })
    })
    await db.putMessage({
      org: ORG,
      message: baseMessage({ messageId: 'r1', threadId: 'm1', inReplyTo: 'm1', assignee: 'linn@x.se' })
    })
  })

  it('setThreadCategory rewrites every member, clears the assignee and bumps activity', async () => {
    const moved = await db.setThreadCategory({ org: ORG, threadId: 'm1', category: 'agility' })
    expect(moved).toBe(2)
    const members = await db.listThread({ org: ORG, threadId: 'm1' })
    expect(members.map((m) => m.category)).toEqual(['agility', 'agility'])
    expect(members.every((m) => m.assignee === null)).toBe(true)
    const root = await db.getMessage({ org: ORG, messageId: 'm1' })
    expect(root.lastActivityAt > '2026-06-01T10:00:00Z').toBe(true)
  })

  it('listMessageCategories returns the distinct categories in use', async () => {
    await db.putMessage({ org: ORG, message: baseMessage({ messageId: 'm2', category: 'styrelsen' }) })
    expect((await db.listMessageCategories({ org: ORG })).sort()).toEqual(['kurser', 'styrelsen'])
  })
})

describe('Database concurrent message updates', () => {
  const org = 'acme'
  const messageId = 'm-race'

  const seeded = async (db) => {
    await db.putMessage({
      org,
      message: {
        messageId,
        category: 'support',
        from: 'a@b.se',
        subject: 'race',
        receivedAt: '2026-09-01T10:00:00.000Z'
      }
    })
  }

  it('two agents changing different fields at once do not clobber each other', async () => {
    const client = new FakeDocClient()
    const db = new Database({ docClient: client, tableName: 't' })
    await seeded(db)

    // Both handlers read, then both write — the classic lost update. With
    // read-modify-write one of these two fields is silently dropped.
    await Promise.all([
      db.setMessageState({ org, messageId, state: 'pending' }),
      db.setMessageAssignee({ org, messageId, assignee: 'agent@acme.example' })
    ])

    const after = await db.getMessage({ org, messageId })
    expect(after.state).toBe('pending')
    expect(after.assignee).toBe('agent@acme.example')
  })

  it('archiving moves the row between the two list partitions', async () => {
    const client = new FakeDocClient()
    const db = new Database({ docClient: client, tableName: 't' })
    await seeded(db)

    await db.setMessageBox({ org, messageId, box: 'archived' })

    expect(await db.listMessagesByBox({ org, box: 'inbox' })).toHaveLength(0)
    expect(await db.listMessagesByBox({ org, box: 'archived' })).toHaveLength(1)
  })

  it('updating a message that is gone is a 404, not a resurrection', async () => {
    const client = new FakeDocClient()
    const db = new Database({ docClient: client, tableName: 't' })
    await expect(
      db.setMessageState({ org, messageId: 'nope', state: 'done' })
    ).rejects.toThrow(/not found/i)
    expect(await db.getMessage({ org, messageId: 'nope' })).toBeNull()
  })
})
