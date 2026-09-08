import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { resetTestApi } from '../../setup'
import InboxView from '@/views/InboxView.vue'

const buildRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'inbox', component: InboxView },
      { path: '/m/:messageId', name: 'inbox-message', component: InboxView }
    ]
  })

const mountView = async (initial = '/') => {
  const router = buildRouter()
  router.push(initial)
  await router.isReady()
  const w = mount(InboxView, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

// jsdom's Blob has no .text(), and undici's Response won't consume it.
const readBlob = (blob) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = reject
    fr.readAsText(blob)
  })

describe('InboxView (integration with store + fetch shim)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetTestApi()
  })

  it('tapping an attachment saves the decoded file', async () => {
    // Capture what the browser would be asked to download.
    const created = []
    const clicks = []
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn((blob) => {
      created.push(blob)
      return 'blob:stub'
    })
    URL.revokeObjectURL = vi.fn()
    const origClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function click() {
      clicks.push({ download: this.download, href: this.href })
    }

    try {
      const { w } = await mountView('/m/m-old')
      await flushPromises()
      const chip = w.find('[data-testid="attachment"]')
      expect(chip.exists()).toBe(true)

      await chip.trigger('click')
      await flushPromises()

      expect(clicks).toHaveLength(1)
      // The filename the mail carried, not the message id or a blob name.
      expect(clicks[0].download).toBe('protokoll.pdf')
      expect(created).toHaveLength(1)
      expect(created[0].type).toBe('application/pdf')
      // Base64 in the JSON must come back out as the original bytes.
      expect(await readBlob(created[0])).toBe('%PDF-1.4 stub')
    } finally {
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
      HTMLAnchorElement.prototype.click = origClick
    }
  })

  it('explains a missing attachment instead of failing silently', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const { w } = await mountView('/m/m-old')
    await flushPromises()
    // 404 from the API: the raw mail has aged out of S3.
    globalThis.fetch.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ code: 'MESSAGE_NOT_FOUND' }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      })
    )
    await w.find('[data-testid="attachment"]').trigger('click')
    await flushPromises()
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('rensats'))
    alert.mockRestore()
  })

  it('loads and lists inbox messages newest-first', async () => {
    const { w } = await mountView()
    const items = w.findAll('.list-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('Anna Svensson')
  })

  it('selecting a message puts it in the URL and opens it', async () => {
    const { w, router } = await mountView()
    await w.findAll('.list-item')[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.params.messageId).toBe('m-new')
    expect(w.find('.pane-reader').text()).toContain('nästa kurs')
  })

  it('deep-links: opening /m/:id directly reopens that message', async () => {
    const { w } = await mountView('/m/m-old')
    await flushPromises()
    expect(w.find('.pane-reader').text()).toContain('protokollet')
  })

  // Count GET /admin/messages (list) fetches; the silent refresh re-hits it.
  const listFetches = () =>
    globalThis.fetch.mock.calls.filter(([input, init]) => {
      const url = typeof input === 'string' ? input : input.url
      const method = (init?.method || 'GET').toUpperCase()
      return method === 'GET' && new URL(url).pathname === '/admin/messages'
    }).length

  it('deep-linking to a message missing from the list refreshes the list', async () => {
    // Start on the inbox; m-arch is archived, so it is not in the loaded list.
    const { router } = await mountView()
    const before = listFetches()
    await router.push('/m/m-arch')
    await flushPromises()
    // The watcher opened the message AND pulled a fresh list (the new-item case).
    expect(listFetches()).toBe(before + 1)
  })

  it('deep-linking to a message already in the list does not refetch it', async () => {
    const { router } = await mountView()
    const before = listFetches()
    await router.push('/m/m-old') // already in the loaded inbox list
    await flushPromises()
    expect(listFetches()).toBe(before)
  })

  it('deep-links: shows a loading indicator, not the empty state, while the message loads', async () => {
    const router = buildRouter()
    router.push('/m/m-old')
    await router.isReady()
    const w = mount(InboxView, { global: { plugins: [router] } })
    await nextTick()
    const reader = w.find('.pane-reader')
    expect(reader.find('[data-testid="spinner"]').exists()).toBe(true)
    expect(reader.text()).not.toContain('Inget meddelande valt')
  })

  it('deep-links: still marks the message read in the list', async () => {
    const { w } = await mountView('/m/m-new')
    await flushPromises()
    expect(w.findAll('.list-item')[0].classes()).not.toContain('unread')
  })

  it('opening a message marks it read', async () => {
    const { w } = await mountView()
    await w.findAll('.list-item')[0].trigger('click')
    await flushPromises()
    expect(w.findAll('.list-item')[0].classes()).not.toContain('unread')
  })

  it('archiving removes the message from the inbox list', async () => {
    const { w } = await mountView()
    await w.findAll('.list-item')[0].trigger('click')
    await flushPromises()
    await w.find('[data-testid="archive"]').trigger('click')
    await flushPromises()
    expect(w.findAll('.list-item')).toHaveLength(1)
  })

  it('archiving updates the sidebar counts immediately', async () => {
    const { w } = await mountView()
    // seed: m-new (kurser) + m-old (styrelse) in inbox → Inkorg total 2
    const inkorgCount = () => w.findAll('.side-link')[0].find('.count').text()
    expect(inkorgCount()).toBe('2')
    await w.findAll('.list-item')[0].trigger('click') // m-new (kurser)
    await flushPromises()
    await w.find('[data-testid="archive"]').trigger('click')
    await flushPromises()
    expect(inkorgCount()).toBe('1')
    expect(w.text()).not.toContain('kurser')
  })

  it('a sent reply shows inside the thread, not as a new list row', async () => {
    const { w } = await mountView('/m/m-new')
    await flushPromises()
    await w.find('[data-testid="reply-body"]').setValue('Tack för din fråga!')
    await w.find('[data-testid="send-reply"]').trigger('click')
    await w.find('[data-testid="confirm-send-close"]').trigger('click')
    await flushPromises()
    // thread now has the inbound + our outbound reply
    expect(w.findAll('[data-testid="thread-msg"]')).toHaveLength(2)
    // list still shows only the original inbox rows (no duplicate reply row)
    expect(w.findAll('.list-item')).toHaveLength(2)
  })

  it('Send and close flips the message state to Klar', async () => {
    const { w } = await mountView('/m/m-new')
    await flushPromises()
    await w.find('[data-testid="reply-body"]').setValue('Klart!')
    await w.find('[data-testid="send-reply"]').trigger('click')
    await w.find('[data-testid="confirm-send-close"]').trigger('click')
    await flushPromises()
    expect(w.find('.badge.state-done').exists()).toBe(true)
  })

  it('adding an internal note appends it to the thread', async () => {
    const { w } = await mountView('/m/m-new')
    await flushPromises()
    await w.find('[data-testid="tab-note"]').trigger('click')
    await w.find('[data-testid="reply-body"]').setValue('Ring upp Anna')
    await w.find('[data-testid="save-note"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="note"]').text()).toContain('Ring upp Anna')
  })

  it('deleting an archived thread removes it (after confirm)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { w, router } = await mountView('/m/m-arch') // archived seed
    await flushPromises()
    expect(w.find('[data-testid="delete"]').exists()).toBe(true)
    await w.find('[data-testid="delete"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('inbox')
    // archived box no longer contains m-arch
    await router.push('/')
    await flushPromises()
    window.confirm.mockRestore()
  })

  it('transferring a message moves it and leaves the reader (after confirm)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { w, router } = await mountView('/m/m-new') // kurser
    await flushPromises()
    await w.find('[data-testid="category-select"]').setValue('styrelse')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('inbox')
    // Back in the list the row now sits under the new category.
    const row = w.findAll('.list-item').find((r) => r.text().includes('nybörjarkurs'))
    await row.trigger('click')
    await flushPromises()
    expect(w.find('.li-cat').text()).toBe('styrelse')
    window.confirm.mockRestore()
  })

  it('declining the transfer confirm changes nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { w, router } = await mountView('/m/m-new')
    await flushPromises()
    await w.find('[data-testid="category-select"]').setValue('styrelse')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('inbox-message')
    expect(w.find('.li-cat').text()).toBe('kurser')
    window.confirm.mockRestore()
  })

  it('filtering by category narrows the list', async () => {
    const { w } = await mountView()
    const catBtn = w.findAll('.side-link').find((b) => b.text().includes('styrelse'))
    await catBtn.trigger('click')
    await flushPromises()
    const items = w.findAll('.list-item')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain('Mötesprotokoll')
  })
})
