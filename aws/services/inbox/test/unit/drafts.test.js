import { describe, it, expect, beforeEach } from 'vitest'
import { FakeDocClient } from '../helper/fake-doc-client.js'
import { FakeSes } from '../helper/fake-ses.js'
import { FakeMailStore } from '../helper/fake-mail-store.js'
import { Database } from '../../src/database.js'
import {
  detail,
  createDraft,
  sendDraft,
  rejectDraft,
  deleteDraft
} from '../../src/messages/admin.js'
import { strings } from '../../src/strings.js'

const ORG = 'acme'

const claimsFor = (email, categories = '*') => ({
  email,
  orgs: JSON.stringify({ [ORG]: { name: 'Acme Ltd', categories, active: true } })
})
const author = claimsFor('junior@acme.example')
const approver = claimsFor('boss@acme.example')

const makeDeps = () => ({
  db: new Database({ docClient: new FakeDocClient(), tableName: 't' }),
  ses: new FakeSes(),
  mailStore: new FakeMailStore(),
  sender: 'support@acme.example',
  webBaseUrl: 'https://inbox.example'
})

describe('reply drafts', () => {
  let deps
  beforeEach(async () => {
    deps = makeDeps()
    await deps.db.putMessage({
      org: ORG,
      message: {
        messageId: 'm1',
        category: 'kurser',
        from: 'Anna <anna@example.se>',
        to: ['kurser@acme.example'],
        subject: 'Fraga om kurs',
        receivedAt: '2026-06-01T10:00:00Z',
        status: 'read',
        direction: 'inbound',
        box: 'inbox'
      }
    })
    for (const [email, name, role, categories] of [
      ['junior@acme.example', 'Junior', 'admin', ['kurser']],
      ['boss@acme.example', 'Boss', 'superadmin', []],
      ['other@acme.example', 'Other', 'admin', ['styrelse']]
    ]) {
      await deps.db.putAdmin({
        org: ORG,
        admin: { email, name, role, categories, notifyReply: true }
      })
    }
  })

  const propose = (text = 'Hej Anna, kursen startar i augusti.') =>
    createDraft({ deps, org: ORG, pathParameters: { messageId: 'm1' }, body: { body: text }, claims: author })

  it('creates a pending draft that detail lists separately from notes', async () => {
    const res = await propose()
    expect(res.statusCode).toBe(201)
    expect(res.data).toMatchObject({ kind: 'draft', status: 'pending', author: 'junior@acme.example' })
    expect(res.data.draftId).toBe(res.data.createdAt)
    const d = await detail({ deps, org: ORG, pathParameters: { messageId: 'm1' }, claims: approver })
    expect(d.notes).toEqual([])
    expect(d.drafts).toHaveLength(1)
    expect(d.drafts[0]).toMatchObject({ status: 'pending', authorName: 'Junior' })
    const log = await deps.db.listAudit({ org: ORG })
    expect(log[0]).toMatchObject({ action: 'draft.create', targetId: 'm1' })
  })

  it('rejects an empty draft', async () => {
    await expect(propose('  ')).rejects.toMatchObject({ code: 'REPLY_BODY_REQUIRED' })
  })

  it('mails the category admins minus the author, deep-linking to the draft', async () => {
    const { data } = await propose()
    expect(deps.ses.notifications.map((n) => n.to)).toEqual(['boss@acme.example'])
    const n = deps.ses.notifications[0]
    expect(n.subject).toBe(strings().draftSubject('Junior', 'Fraga om kurs'))
    expect(n.paragraphs).toContain('Hej Anna, kursen startar i augusti.')
    expect(n.ctaUrl).toBe(`https://inbox.example/#/m/m1?draft=${data.createdAt}`)
  })

  it('send mails the override text as the approver and marks the draft sent', async () => {
    const { data } = await propose()
    const res = await sendDraft({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1', draftId: data.draftId },
      body: { body: 'Redigerat svar' },
      claims: approver
    })
    expect(res.statusCode).toBe(201)
    expect(deps.ses.replies).toHaveLength(1)
    expect(deps.ses.replies[0].body).toBe('Redigerat svar')
    expect(res.data.sentBy).toBe('boss@acme.example')
    expect(res.data.assignee).toBe('boss@acme.example')
    const d = await detail({ deps, org: ORG, pathParameters: { messageId: 'm1' }, claims: approver })
    expect(d.drafts[0]).toMatchObject({
      status: 'sent',
      resolvedBy: 'boss@acme.example',
      sentMessageId: res.data.messageId
    })
    const log = await deps.db.listAudit({ org: ORG })
    const reply = log.find((e) => e.action === 'reply')
    expect(reply.actor.email).toBe('boss@acme.example')
    expect(reply.meta).toMatchObject({ draftId: data.draftId, proposedBy: 'junior@acme.example' })
  })

  it('send without override mails the draft text', async () => {
    const { data } = await propose()
    await sendDraft({ deps, org: ORG, pathParameters: { messageId: 'm1', draftId: data.draftId }, body: {}, claims: approver })
    expect(deps.ses.replies[0].body).toBe('Hej Anna, kursen startar i augusti.')
  })

  it('an approver outside the category gets 404', async () => {
    const { data } = await propose()
    await expect(
      sendDraft({
        deps,
        org: ORG,
        pathParameters: { messageId: 'm1', draftId: data.draftId },
        body: {},
        claims: claimsFor('other@acme.example', ['styrelse'])
      })
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('an unknown draft is 404', async () => {
    await expect(
      sendDraft({ deps, org: ORG, pathParameters: { messageId: 'm1', draftId: 'nope' }, body: {}, claims: approver })
    ).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' })
  })

  it('a sent draft can be neither sent nor rejected again', async () => {
    const { data } = await propose()
    const p = { deps, org: ORG, pathParameters: { messageId: 'm1', draftId: data.draftId }, claims: approver }
    await sendDraft({ ...p, body: {} })
    await expect(sendDraft({ ...p, body: {} })).rejects.toMatchObject({ name: 'ConflictError', code: 'DRAFT_NOT_PENDING' })
    await expect(rejectDraft({ ...p, body: {} })).rejects.toMatchObject({ name: 'ConflictError' })
    expect(deps.ses.replies).toHaveLength(1)
  })

  it('reject stores the reason and who rejected', async () => {
    const { data } = await propose()
    const res = await rejectDraft({
      deps,
      org: ORG,
      pathParameters: { messageId: 'm1', draftId: data.draftId },
      body: { reason: 'För kort' },
      claims: approver
    })
    expect(res).toMatchObject({ status: 'rejected', reason: 'För kort', resolvedBy: 'boss@acme.example' })
    const log = await deps.db.listAudit({ org: ORG })
    expect(log.find((e) => e.action === 'draft.reject').meta).toMatchObject({ draftId: data.draftId, reason: 'För kort' })
  })

  it('only the author deletes, and only while pending', async () => {
    const { data } = await propose()
    const p = { deps, org: ORG, pathParameters: { messageId: 'm1', draftId: data.draftId } }
    await expect(deleteDraft({ ...p, claims: approver })).rejects.toMatchObject({ name: 'NotFoundError' })
    await rejectDraft({ ...p, body: {}, claims: approver })
    await expect(deleteDraft({ ...p, claims: author })).rejects.toMatchObject({ code: 'DRAFT_NOT_PENDING' })
    // The id is the creation time, so the second draft needs its own millisecond.
    await new Promise((r) => setTimeout(r, 2))
    const { data: again } = await propose()
    const res = await deleteDraft({ ...p, pathParameters: { messageId: 'm1', draftId: again.draftId }, claims: author })
    expect(res.statusCode).toBe(204)
    const d = await detail({ deps, org: ORG, pathParameters: { messageId: 'm1' }, claims: approver })
    expect(d.drafts.map((x) => x.status)).toEqual(['rejected'])
    const log = await deps.db.listAudit({ org: ORG })
    expect(log.some((e) => e.action === 'draft.delete')).toBe(true)
  })
})
