import { defineStore } from 'pinia'
import {
  listMessagesAPI,
  getMessageAPI,
  getRawAPI,
  getAttachmentAPI,
  updateMessageAPI,
  replyAPI,
  addNoteAPI,
  deleteMessageAPI,
  transferMessageAPI,
  searchMessagesAPI,
  countsAPI
} from '@/services/inbox-service'
import { useAdminSessionStore } from '@/stores/admin-session-store'

const createLoading = () => ({
  list: false,
  detail: false,
  reply: false,
  update: false
})
const createError = () => ({
  list: null,
  detail: null,
  reply: null,
  update: null
})

export const useInboxStore = defineStore('inbox-store', {
  state: () => ({
    messages: [],
    // Pages visited, newest first: the cursor that fetches each and the row
    // offset it starts at. The last entry is the page shown.
    pages: [{ cursor: null, start: 0 }],
    nextCursor: null,
    counts: {},
    current: null,
    filters: { box: 'inbox', category: null, state: null, assignment: 'all' },
    searchQuery: '',
    searchResults: [],
    loading: createLoading(),
    error: createError()
  }),
  getters: {
    // The list shown: search results when searching, else the filtered box list.
    visibleMessages: (s) => (s.searchQuery ? s.searchResults : s.filteredMessages),
    filteredMessages: (s) => {
      const myEmail = useAdminSessionStore().user?.email
      return s.messages.filter((m) => {
        if (s.filters.category && m.category !== s.filters.category) return false
        if (s.filters.state && (m.state || 'open') !== s.filters.state) return false
        if (s.filters.assignment === 'mine' && m.assignee !== myEmail) return false
        if (s.filters.assignment === 'unassigned' && m.assignee) return false
        return true
      })
    },
    page: (s) => s.pages.at(-1),
    categoriesWithCounts: (s) =>
      Object.entries(s.counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
  },
  actions: {
    // A page emptied under the agent (its last rows archived) steps back one.
    async fetchPageAction() {
      countsAPI()
        .then((counts) => (this.counts = counts))
        .catch(() => {})
      for (;;) {
        const { items, cursor } = await listMessagesAPI({ ...this.filters, cursor: this.page.cursor })
        if (items.length || this.pages.length === 1) {
          this.messages = items
          this.nextCursor = cursor
          return
        }
        this.pages.pop()
      }
    },

    async loadMessagesAction() {
      this.loading.list = true
      this.error.list = null
      try {
        await this.fetchPageAction()
      } catch (e) {
        this.error.list = e
        throw e
      } finally {
        this.loading.list = false
      }
    },

    // Silent background refresh — no loading flag (no spinner flicker) and
    // errors are swallowed so a transient failure never interrupts the user.
    // Only replaces the list; the open message + composer draft are untouched.
    async refreshMessagesAction() {
      try {
        await this.fetchPageAction()
      } catch {
        // ignore — next poll retries
      }
    },

    async nextPageAction() {
      if (!this.nextCursor) return
      this.pages.push({ cursor: this.nextCursor, start: this.page.start + this.messages.length })
      await this.loadMessagesAction()
    },

    async prevPageAction() {
      if (this.pages.length === 1) return
      this.pages.pop()
      await this.loadMessagesAction()
    },

    // Any change of filter starts over on the first page.
    async reloadFromStartAction() {
      this.pages = [{ cursor: null, start: 0 }]
      await this.loadMessagesAction()
    },

    async setBoxAction(box) {
      this.filters.box = box
      this.filters.category = null
      this.filters.assignment = 'all'
      this.current = null
      await this.reloadFromStartAction()
    },

    async setCategory(category) {
      this.filters.category = category || null
      await this.reloadFromStartAction()
    },

    async setStateFilter(state) {
      this.filters.state = state || null
      await this.reloadFromStartAction()
    },

    // 'all' | 'mine' | 'unassigned' — also forces the inbox box.
    async setAssignment(assignment) {
      this.filters.assignment = assignment || 'all'
      this.filters.category = null
      await this.reloadFromStartAction()
    },

    async searchAction(q) {
      const query = String(q || '').trim()
      this.searchQuery = query
      if (!query) {
        this.searchResults = []
        return
      }
      try {
        this.searchResults = await searchMessagesAPI(query)
      } catch {
        this.searchResults = []
      }
    },

    clearSearch() {
      this.searchQuery = ''
      this.searchResults = []
    },

    async setAssigneeAction(id, assignee) {
      await updateMessageAPI(id, { assignee: assignee || null })
      const row = this.messages.find((m) => m.messageId === id)
      if (row) row.assignee = assignee || null
      if (this.current?.messageId === id) this.current.assignee = assignee || null
    },

    async openMessageAction(id) {
      this.loading.detail = true
      this.error.detail = null
      try {
        this.current = await getMessageAPI(id)
        const row = this.messages.find((m) => m.messageId === id)
        if (row) row.status = 'read'
        return this.current
      } catch (e) {
        this.error.detail = e
        throw e
      } finally {
        this.loading.detail = false
      }
    },

    // Archive, un-archive, mark spam and un-mark it are all one move: the row
    // changes box. The box being looked at decides whether it leaves the list.
    async moveMessageAction(id, box) {
      this.error.update = null
      // Optimistic: drop from the list immediately so counts update right away.
      const prevMessages = this.messages
      const prevCurrent = this.current
      if (this.filters.box !== box) {
        this.messages = this.messages.filter((m) => m.messageId !== id)
      }
      if (this.current?.messageId === id) this.current = null
      try {
        await updateMessageAPI(id, { box })
      } catch (e) {
        // Roll back on failure.
        this.messages = prevMessages
        this.current = prevCurrent
        this.error.update = e
        throw e
      }
      // Refill the page and the counts from the server.
      this.refreshMessagesAction()
    },

    // Hand the issue to another category's team. Not optimistic-with-rollback
    // like archive: after the move only the server knows whether this admin can
    // still see the thread, so drop it and let the re-list put it back if so.
    // ponytail: one PATCH per message; a bulk endpoint if lists grow to hundreds.
    // Re-list either way, so a partial failure still shows what really changed.
    async bulkUpdateAction(ids, patch) {
      const results = await Promise.allSettled(ids.map((id) => updateMessageAPI(id, patch)))
      await this.refreshMessagesAction()
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed) throw new Error(`${failed} av ${ids.length} ärenden kunde inte uppdateras.`)
    },

    async transferMessageAction(id, category) {
      await transferMessageAPI(id, category)
      this.messages = this.messages.filter((m) => m.messageId !== id)
      if (this.current?.messageId === id) this.current = null
      await this.refreshMessagesAction()
    },

    async setStatusAction(id, status) {
      await updateMessageAPI(id, { status })
      const row = this.messages.find((m) => m.messageId === id)
      if (row) row.status = status
      if (this.current?.messageId === id) this.current.status = status
    },

    async deleteMessageAction(id) {
      await deleteMessageAPI(id)
      this.messages = this.messages.filter((m) => m.messageId !== id)
      if (this.current?.messageId === id) this.current = null
      this.refreshMessagesAction()
    },

    async setStateAction(id, state) {
      await updateMessageAPI(id, { state })
      const row = this.messages.find((m) => m.messageId === id)
      if (row) row.state = state
      if (this.current?.messageId === id) this.current.state = state
    },

    async addNoteAction(id, text) {
      const note = await addNoteAPI(id, text)
      if (this.current?.messageId === id) {
        this.current.notes = [...(this.current.notes || []), note]
      }
      return note
    },

    async fetchRawAction(id) {
      return getRawAPI(id)
    },

    async fetchAttachmentAction(id, index) {
      return getAttachmentAPI(id, index)
    },

    async replyAction(id, payload) {
      this.loading.reply = true
      this.error.reply = null
      try {
        const out = await replyAPI(id, payload)
        // The reply may auto-assign an unassigned issue to the replying admin.
        // Reflect the resulting assignee immediately (no reload / flicker).
        if (out && out.assignee) {
          const row = this.messages.find((m) => m.messageId === id)
          if (row) row.assignee = out.assignee
          if (this.current?.messageId === id) this.current.assignee = out.assignee
        }
        return out
      } catch (e) {
        this.error.reply = e
        throw e
      } finally {
        this.loading.reply = false
      }
    }
  }
})
