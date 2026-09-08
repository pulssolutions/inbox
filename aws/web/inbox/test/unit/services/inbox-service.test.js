import { describe, it, expect, beforeEach } from 'vitest'
import { resetTestApi } from '../../setup'
import {
  listMessagesAPI,
  getMessageAPI,
  updateMessageAPI,
  replyAPI,
  getAttachmentAPI,
  loadCategoriesAPI,
  transferMessageAPI
} from '@/services/inbox-service'

describe('inbox-service (against fetch shim)', () => {
  beforeEach(() => resetTestApi())

  it('lists inbox messages newest-first by default', async () => {
    const list = await listMessagesAPI()
    expect(list.map((m) => m.messageId)).toEqual(['m-new', 'm-old'])
  })

  it('lists the archived box', async () => {
    const list = await listMessagesAPI({ box: 'archived' })
    expect(list.map((m) => m.messageId)).toEqual(['m-arch'])
  })

  it('filters by category server-side', async () => {
    const list = await listMessagesAPI({ category: 'styrelse' })
    expect(list.map((m) => m.messageId)).toEqual(['m-old'])
  })

  it('gets a message with a thread body and marks it read', async () => {
    const msg = await getMessageAPI('m-new')
    expect(msg.thread[0].text).toContain('nästa kurs')
    expect(msg.status).toBe('read')
  })

  it('fetches an attachment by thread-member id and index', async () => {
    const a = await getAttachmentAPI('m-old', 0)
    expect(a.filename).toBe('protokoll.pdf')
    expect(a.contentType).toBe('application/pdf')
    expect(atob(a.contentBase64)).toBe('%PDF-1.4 stub')
  })

  it('404s for an index the message does not have', async () => {
    await expect(getAttachmentAPI('m-old', 7)).rejects.toMatchObject({
      status: 404
    })
  })

  it('updates box (archive)', async () => {
    const res = await updateMessageAPI('m-new', { box: 'archived' })
    expect(res.box).toBe('archived')
  })

  it('replies and returns the outbound record', async () => {
    const res = await replyAPI('m-new', { body: 'Tack!' })
    expect(res.direction).toBe('outbound')
    expect(res.inReplyTo).toBe('m-new')
    expect(res.subject).toBe('Re: Fråga om nybörjarkurs')
  })

  it('lists the org categories', async () => {
    expect(await loadCategoriesAPI()).toEqual(['kurser', 'styrelse'])
  })

  it('transfers a message to another category', async () => {
    const res = await transferMessageAPI('m-new', 'agility')
    expect(res).toMatchObject({ messageId: 'm-new', category: 'agility', assignee: null })
    expect((await listMessagesAPI()).find((x) => x.messageId === 'm-new').category).toBe('agility')
  })
})
