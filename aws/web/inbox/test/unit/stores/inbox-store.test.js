import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useInboxStore } from '@/stores/inbox-store'

vi.mock('@/services/inbox-service', () => ({
  listMessagesAPI: vi.fn(),
  getMessageAPI: vi.fn(),
  getRawAPI: vi.fn(),
  updateMessageAPI: vi.fn(),
  replyAPI: vi.fn(),
  addNoteAPI: vi.fn(),
  deleteMessageAPI: vi.fn(),
  searchMessagesAPI: vi.fn(),
  transferMessageAPI: vi.fn(),
  countsAPI: vi.fn(async () => ({}))
}))

import {
  listMessagesAPI,
  getMessageAPI,
  getRawAPI,
  updateMessageAPI,
  replyAPI,
  addNoteAPI,
  deleteMessageAPI,
  searchMessagesAPI,
  transferMessageAPI,
  countsAPI
} from '@/services/inbox-service'
import { useAdminSessionStore } from '@/stores/admin-session-store'

const page = (items, cursor = null) => ({ items, cursor })

const msg = (over = {}) => ({
  messageId: 'm1',
  category: 'kurser',
  from: 'Anna <anna@example.se>',
  subject: 'Hej',
  receivedAt: '2026-06-02T09:00:00Z',
  status: 'unread',
  box: 'inbox',
  ...over
})

describe('inbox-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    listMessagesAPI.mockReset()
  })

  it('initial state is empty + inbox box', () => {
    const s = useInboxStore()
    expect(s.messages).toEqual([])
    expect(s.filters.box).toBe('inbox')
    expect(s.loading.list).toBe(false)
  })

  it('loadMessagesAction loads the current box', async () => {
    listMessagesAPI.mockResolvedValueOnce(page([msg()]))
    const s = useInboxStore()
    const p = s.loadMessagesAction()
    expect(s.loading.list).toBe(true)
    await p
    expect(listMessagesAPI).toHaveBeenCalledWith(expect.objectContaining({ box: 'inbox', cursor: null }))
    expect(s.messages).toHaveLength(1)
    expect(s.loading.list).toBe(false)
  })

  it('loadMessagesAction records errors', async () => {
    const err = new Error('boom')
    listMessagesAPI.mockRejectedValueOnce(err)
    const s = useInboxStore()
    await expect(s.loadMessagesAction()).rejects.toThrow('boom')
    expect(s.error.list).toBe(err)
  })

  it('setBoxAction switches box, clears category, reloads', async () => {
    listMessagesAPI.mockResolvedValue(page([msg({ box: 'archived' })]))
    const s = useInboxStore()
    s.filters.category = 'kurser'
    await s.setBoxAction('archived')
    expect(s.filters.box).toBe('archived')
    expect(s.filters.category).toBeNull()
    expect(listMessagesAPI).toHaveBeenCalledWith(expect.objectContaining({ box: 'archived', cursor: null }))
  })

  it('filters by workflow state', () => {
    const s = useInboxStore()
    s.messages = [msg({ messageId: 'a', state: 'open' }), msg({ messageId: 'b', state: 'done' })]
    s.setStateFilter('done')
    expect(s.filteredMessages.map((m) => m.messageId)).toEqual(['b'])
  })

  it('filters by assignment (mine / unassigned)', () => {
    useAdminSessionStore().user = { email: 'me@x.se' }
    const s = useInboxStore()
    s.messages = [
      msg({ messageId: 'mine', assignee: 'me@x.se' }),
      msg({ messageId: 'theirs', assignee: 'other@x.se' }),
      msg({ messageId: 'none', assignee: null })
    ]
    s.setAssignment('mine')
    expect(s.filteredMessages.map((m) => m.messageId)).toEqual(['mine'])
    s.setAssignment('unassigned')
    expect(s.filteredMessages.map((m) => m.messageId)).toEqual(['none'])
  })

  it('search mode swaps the visible list, clearSearch restores it', async () => {
    searchMessagesAPI.mockResolvedValueOnce([msg({ messageId: 'hit' })])
    const s = useInboxStore()
    s.messages = [msg({ messageId: 'a' }), msg({ messageId: 'b' })]
    await s.searchAction('valp')
    expect(s.visibleMessages.map((m) => m.messageId)).toEqual(['hit'])
    s.clearSearch()
    expect(s.visibleMessages.map((m) => m.messageId)).toEqual(['a', 'b'])
  })

  it('setAssigneeAction updates the message + current', async () => {
    updateMessageAPI.mockResolvedValueOnce({})
    const s = useInboxStore()
    s.messages = [msg({ messageId: 'm1' })]
    s.current = { ...msg({ messageId: 'm1' }) }
    await s.setAssigneeAction('m1', 'linn@x.se')
    expect(updateMessageAPI).toHaveBeenCalledWith('m1', { assignee: 'linn@x.se' })
    expect(s.messages[0].assignee).toBe('linn@x.se')
    expect(s.current.assignee).toBe('linn@x.se')
  })

  it('filteredMessages honors selected category', () => {
    const s = useInboxStore()
    s.messages = [
      msg({ messageId: 'a', category: 'kurser' }),
      msg({ messageId: 'b', category: 'styrelse' })
    ]
    s.filters.category = 'styrelse'
    expect(s.filteredMessages.map((m) => m.messageId)).toEqual(['b'])
    s.filters.category = null
    expect(s.filteredMessages).toHaveLength(2)
  })

  it('openMessageAction loads detail and marks the list row read', async () => {
    getMessageAPI.mockResolvedValueOnce({
      ...msg(),
      status: 'read',
      body: { text: 'hi', html: null, attachments: [] }
    })
    const s = useInboxStore()
    s.messages = [msg({ status: 'unread' })]
    await s.openMessageAction('m1')
    expect(s.current.body.text).toBe('hi')
    expect(s.messages[0].status).toBe('read')
  })

  it.each([
    ['inbox', 'archived'],
    ['inbox', 'spam'],
    ['archived', 'inbox'],
    ['spam', 'inbox']
  ])('moveMessageAction %s → %s drops the row and clears current', async (from, to) => {
    updateMessageAPI.mockResolvedValueOnce({ ...msg(), box: to })
    const s = useInboxStore()
    s.filters.box = from
    s.messages = [msg({ box: from })]
    s.current = { ...msg({ box: from }) }
    await s.moveMessageAction('m1', to)
    expect(updateMessageAPI).toHaveBeenCalledWith('m1', { box: to })
    expect(s.messages).toHaveLength(0)
    expect(s.current).toBeNull()
  })

  it('moveMessageAction keeps the row when it is not leaving the box in view', async () => {
    updateMessageAPI.mockResolvedValueOnce({ ...msg(), box: 'spam' })
    const s = useInboxStore()
    s.filters.box = 'spam'
    s.messages = [msg({ box: 'spam' })]
    await s.moveMessageAction('m1', 'spam')
    expect(s.messages).toHaveLength(1)
  })

  it('moveMessageAction rolls the list back when the API fails', async () => {
    updateMessageAPI.mockRejectedValueOnce(new Error('nope'))
    const s = useInboxStore()
    s.messages = [msg()]
    s.current = { ...msg() }
    await expect(s.moveMessageAction('m1', 'spam')).rejects.toThrow('nope')
    expect(s.messages).toHaveLength(1)
    expect(s.current).not.toBeNull()
    expect(s.error.update).toBeTruthy()
  })

  it('transferMessageAction drops the row, clears current and re-lists', async () => {
    transferMessageAPI.mockResolvedValueOnce({ ...msg(), category: 'agility' })
    listMessagesAPI.mockResolvedValueOnce(page([]))
    const s = useInboxStore()
    s.messages = [msg()]
    s.current = { ...msg() }
    await s.transferMessageAction('m1', 'agility')
    expect(transferMessageAPI).toHaveBeenCalledWith('m1', 'agility')
    expect(s.messages).toHaveLength(0)
    expect(s.current).toBeNull()
    // Only the server knows whether the actor still sees it — hence the re-list.
    expect(listMessagesAPI).toHaveBeenCalled()
  })

  it('setStateAction updates the message state via the API', async () => {
    updateMessageAPI.mockResolvedValueOnce({})
    const s = useInboxStore()
    s.messages = [msg({ state: 'open' })]
    s.current = { ...msg({ state: 'open' }) }
    await s.setStateAction('m1', 'done')
    expect(updateMessageAPI).toHaveBeenCalledWith('m1', { state: 'done' })
    expect(s.messages[0].state).toBe('done')
    expect(s.current.state).toBe('done')
  })

  it('bulkUpdateAction patches every message, then re-lists', async () => {
    updateMessageAPI.mockResolvedValue({})
    listMessagesAPI.mockResolvedValueOnce(page([msg({ messageId: 'm3' })]))
    const s = useInboxStore()
    s.messages = [msg(), msg({ messageId: 'm2' }), msg({ messageId: 'm3' })]
    await s.bulkUpdateAction(['m1', 'm2'], { box: 'archived' })
    expect(updateMessageAPI).toHaveBeenCalledWith('m1', { box: 'archived' })
    expect(updateMessageAPI).toHaveBeenCalledWith('m2', { box: 'archived' })
    expect(s.messages.map((m) => m.messageId)).toEqual(['m3'])
  })

  it('bulkUpdateAction still re-lists, then throws, when one patch fails', async () => {
    updateMessageAPI.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('nope'))
    listMessagesAPI.mockResolvedValueOnce(page([msg({ messageId: 'm2' })]))
    const s = useInboxStore()
    await expect(s.bulkUpdateAction(['m1', 'm2'], { state: 'done' })).rejects.toThrow()
    expect(s.messages.map((m) => m.messageId)).toEqual(['m2'])
  })

  it('addNoteAction posts a note and appends it to the open thread', async () => {
    const note = { messageId: 'm1', text: 'ring upp', author: 'a@x', createdAt: 'z' }
    addNoteAPI.mockResolvedValueOnce(note)
    const s = useInboxStore()
    s.current = { ...msg(), notes: [] }
    const out = await s.addNoteAction('m1', 'ring upp')
    expect(addNoteAPI).toHaveBeenCalledWith('m1', 'ring upp')
    expect(out).toEqual(note)
    expect(s.current.notes).toEqual([note])
  })

  it('refreshMessagesAction updates the list without toggling loading', async () => {
    listMessagesAPI.mockResolvedValueOnce(page([msg({ messageId: 'fresh' })]))
    const s = useInboxStore()
    const p = s.refreshMessagesAction()
    expect(s.loading.list).toBe(false) // never flips → no spinner flicker
    await p
    expect(s.messages.map((m) => m.messageId)).toEqual(['fresh'])
  })

  it('refreshMessagesAction swallows errors (no error flash)', async () => {
    listMessagesAPI.mockRejectedValueOnce(new Error('blip'))
    const s = useInboxStore()
    s.messages = [msg()]
    await s.refreshMessagesAction()
    expect(s.error.list).toBeNull()
    expect(s.messages).toHaveLength(1) // kept previous list
  })

  it('deleteMessageAction removes the message and clears current', async () => {
    deleteMessageAPI.mockResolvedValueOnce({ id: 'm1', deleted: true })
    const s = useInboxStore()
    s.messages = [msg({ messageId: 'm1' }), msg({ messageId: 'm2' })]
    s.current = { ...msg({ messageId: 'm1' }) }
    await s.deleteMessageAction('m1')
    expect(deleteMessageAPI).toHaveBeenCalledWith('m1')
    expect(s.messages.map((m) => m.messageId)).toEqual(['m2'])
    expect(s.current).toBeNull()
  })

  it('fetchRawAction returns the raw payload from the service', async () => {
    getRawAPI.mockResolvedValueOnce({ raw: 'RAW', filename: 'm1.eml' })
    const s = useInboxStore()
    const out = await s.fetchRawAction('m1')
    expect(getRawAPI).toHaveBeenCalledWith('m1')
    expect(out).toEqual({ raw: 'RAW', filename: 'm1.eml' })
  })

  it('replyAction calls the service and returns the outbound record', async () => {
    replyAPI.mockResolvedValueOnce({ messageId: 'r1', direction: 'outbound' })
    const s = useInboxStore()
    const out = await s.replyAction('m1', { body: 'Tack!' })
    expect(replyAPI).toHaveBeenCalledWith('m1', { body: 'Tack!' })
    expect(out.messageId).toBe('r1')
  })

  it('replyAction reflects an auto-assigned assignee on the row + current', async () => {
    replyAPI.mockResolvedValueOnce({ messageId: 'r1', direction: 'outbound', assignee: 'me@x.se' })
    const s = useInboxStore()
    s.messages = [msg({ messageId: 'm1', assignee: null })]
    s.current = { ...msg({ messageId: 'm1', assignee: null }) }
    await s.replyAction('m1', { body: 'Svar' })
    expect(s.messages[0].assignee).toBe('me@x.se')
    expect(s.current.assignee).toBe('me@x.se')
  })

  describe('paging', () => {
    it('steps forward with the cursor and back to the page before', async () => {
      listMessagesAPI
        .mockResolvedValueOnce(page([msg({ messageId: 'a' }), msg({ messageId: 'b' })], 'c1'))
        .mockResolvedValueOnce(page([msg({ messageId: 'c' })]))
        .mockResolvedValueOnce(page([msg({ messageId: 'a' }), msg({ messageId: 'b' })], 'c1'))
      const s = useInboxStore()
      await s.loadMessagesAction()
      await s.nextPageAction()
      expect(listMessagesAPI).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }))
      expect(s.page.start).toBe(2)
      expect(s.nextCursor).toBeNull()
      await s.prevPageAction()
      expect(s.page.start).toBe(0)
      expect(s.messages.map((m) => m.messageId)).toEqual(['a', 'b'])
    })

    it('a filter change starts over on the first page', async () => {
      listMessagesAPI.mockResolvedValue(page([msg()], 'c1'))
      const s = useInboxStore()
      await s.loadMessagesAction()
      await s.nextPageAction()
      await s.setCategory('styrelse')
      expect(s.pages).toHaveLength(1)
      expect(listMessagesAPI).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: 'styrelse', cursor: null })
      )
    })

    it('steps back when the page it is on has emptied', async () => {
      listMessagesAPI
        .mockResolvedValueOnce(page([msg({ messageId: 'a' })], 'c1'))
        .mockResolvedValueOnce(page([msg({ messageId: 'b' })]))
        .mockResolvedValueOnce(page([]))
        .mockResolvedValueOnce(page([msg({ messageId: 'a' })]))
      const s = useInboxStore()
      await s.loadMessagesAction()
      await s.nextPageAction()
      await s.refreshMessagesAction()
      expect(s.pages).toHaveLength(1)
      expect(s.messages.map((m) => m.messageId)).toEqual(['a'])
    })

    it('takes the sidebar counts from the server', async () => {
      listMessagesAPI.mockResolvedValueOnce(page([]))
      countsAPI.mockResolvedValueOnce({ styrelse: 1, kurser: 3 })
      const s = useInboxStore()
      await s.loadMessagesAction()
      await vi.waitFor(() => expect(s.categoriesWithCounts).toEqual([
        { name: 'kurser', count: 3 },
        { name: 'styrelse', count: 1 }
      ]))
    })
  })
})
