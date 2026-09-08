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
  addNote,
  remove,
  transfer
} from '../../src/messages/admin.js'

const ORG = 'acme'

// A kurser-only scoped admin. Source of truth = signed per-org claim.
const SCOPED = {
  email: 'leader@acme.example',
  orgs: JSON.stringify({
    acme: { capabilities: { inbox: { read: true, write: true, send: true } }, categories: ['kurser'] }
  })
}
const SUPER = {
  email: 'boss@acme.example',
  orgs: JSON.stringify({
    acme: { capabilities: { inbox: { read: true, write: true, send: true } }, categories: '*' }
  })
}

const msg = (over) => ({
  messageId: 'x',
  category: 'kurser',
  from: 'Anna <anna@example.se>',
  to: ['kurser@acme.example'],
  subject: 's',
  receivedAt: '2026-06-01T10:00:00Z',
  status: 'unread',
  direction: 'inbound',
  box: 'inbox',
  s3Bucket: 'b',
  s3Key: 'inbound/x',
  ...over
})

const makeDeps = () => {
  const docClient = new FakeDocClient()
  const db = new Database({ docClient, tableName: 't' })
  const mailStore = new FakeMailStore()
  return { db, ses: new FakeSes(), mailStore, sender: 'support@acme.example' }
}

const seedBoth = async (deps) => {
  await deps.db.putMessage({ org: ORG, message: msg({ messageId: 'k1', category: 'kurser', s3Key: 'inbound/k1' }) })
  await deps.db.putMessage({ org: ORG, message: msg({ messageId: 's1', category: 'styrelse', s3Key: 'inbound/s1' }) })
  deps.mailStore.seed({ bucket: 'b', key: 'inbound/s1', parsed: { text: 'hemligt', html: null, attachments: [] }, raw: 'RAW styrelse' })
}

describe('category access enforcement (server-side)', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  it('list never returns a disallowed category', async () => {
    await seedBoth(deps)
    const res = await list({ deps, org: ORG, query: {}, claims: SCOPED })
    expect(res.map((m) => m.messageId)).toEqual(['k1'])
  })

  it('superadmin (*) sees every category', async () => {
    await seedBoth(deps)
    const res = await list({ deps, org: ORG, query: {}, claims: SUPER })
    expect(res.map((m) => m.messageId).sort()).toEqual(['k1', 's1'])
  })

  const pp = { messageId: 's1' }

  it('detail on a disallowed category → 404', async () => {
    await seedBoth(deps)
    await expect(
      detail({ deps, org: ORG, pathParameters: pp, claims: SCOPED })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('raw on a disallowed category → 404', async () => {
    await seedBoth(deps)
    await expect(
      raw({ deps, org: ORG, pathParameters: pp, claims: SCOPED })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('reply on a disallowed category → 404 (and no email sent)', async () => {
    await seedBoth(deps)
    await expect(
      reply({ deps, org: ORG, pathParameters: pp, body: { body: 'hej' }, claims: SCOPED })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
    expect(deps.ses.replies).toHaveLength(0)
  })

  it('addNote on a disallowed category → 404 (and no note stored)', async () => {
    await seedBoth(deps)
    await expect(
      addNote({ deps, org: ORG, pathParameters: pp, body: { text: 'spana' }, claims: SCOPED })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
    const notes = await deps.db.listNotesByMessage({ org: ORG, messageId: 's1' })
    expect(notes).toHaveLength(0)
  })

  it('updateStatus on a disallowed category → 404', async () => {
    await seedBoth(deps)
    await expect(
      updateStatus({ deps, org: ORG, pathParameters: pp, body: { state: 'done' }, claims: SCOPED })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('delete on a disallowed category → 404 (and nothing deleted)', async () => {
    await seedBoth(deps)
    await expect(
      remove({ deps, org: ORG, pathParameters: pp, claims: SCOPED })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
    expect(await deps.db.getMessage({ org: ORG, messageId: 's1' })).not.toBeNull()
  })

  it('transfer of a disallowed category → 404 (and nothing moved)', async () => {
    await seedBoth(deps)
    await expect(
      transfer({ deps, org: ORG, pathParameters: pp, body: { category: 'kurser' }, claims: SCOPED })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
    const still = await deps.db.getMessage({ org: ORG, messageId: 's1' })
    expect(still.category).toBe('styrelse')
  })

  // The point of the feature: hand an issue to a team you are not on. After the
  // move it drops out of your own list.
  it('scoped admin MAY transfer out of its own category, then loses the message', async () => {
    await seedBoth(deps)
    await transfer({
      deps,
      org: ORG,
      pathParameters: { messageId: 'k1' },
      body: { category: 'styrelse' },
      claims: SCOPED
    })
    expect(await list({ deps, org: ORG, query: {}, claims: SCOPED })).toEqual([])
    await expect(
      detail({ deps, org: ORG, pathParameters: { messageId: 'k1' }, claims: SCOPED })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('scoped admin CAN access its own category', async () => {
    await seedBoth(deps)
    deps.mailStore.seed({ bucket: 'b', key: 'inbound/k1', parsed: { text: 'ok', html: null, attachments: [] } })
    const res = await detail({ deps, org: ORG, pathParameters: { messageId: 'k1' }, claims: SCOPED })
    expect(res.messageId).toBe('k1')
  })
})
