<template>
  <div class="three-pane" :data-pane="mobilePane">
    <InboxSidebar
      :box="store.filters.box"
      :category="store.filters.category"
      :state="store.filters.state"
      :assignment="store.filters.assignment"
      :categories="store.categoriesWithCounts"
      @select-box="selectBox"
      @select-category="selectCategory"
      @select-state="selectState"
      @select-assignment="selectAssignment"
      @close="showFolders = false"
    />

    <section class="pane pane-list">
      <div class="pane-head">
        <button
          type="button"
          class="btn btn-ghost btn-sm d-md-none"
          data-testid="open-folders"
          aria-label="Visa mappar"
          @click="showFolders = true"
        >
          ☰ Mappar
        </button>
        <div class="pane-title">
          <h2>{{ paneTitle }}</h2>
          <span v-if="activeFilters.length" class="sub" data-testid="pane-filters">
            {{ activeFilters.join(' · ') }}
          </span>
        </div>
        <span class="muted">{{ store.visibleMessages.length }}</span>
      </div>
      <MessageList
        :messages="store.visibleMessages"
        :selected-id="store.current?.messageId || null"
        :loading="store.loading.list"
        @select="openMessage"
      />
    </section>

    <MessageReader
      :message="store.current"
      :replying="store.loading.reply"
      :loading="store.loading.detail"
      :debug="debug"
      :assignees="assignees.list"
      :categories="categories.list"
      :attachment-busy="attachmentBusy"
      @back="closeMessage"
      @archive="store.archiveMessageAction"
      @unarchive="store.unarchiveMessageAction"
      @delete="onDelete"
      @reply="onReply"
      @add-note="onAddNote"
      @set-state="onSetState"
      @set-assignee="onSetAssignee"
      @transfer="onTransfer"
      @download-raw="onDownloadRaw"
      @download-attachment="onDownloadAttachment"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInboxStore } from '@/stores/inbox-store'
import { useAssigneesStore } from '@/stores/assignees-store'
import { useCategoriesStore } from '@/stores/categories-store'
import InboxSidebar from '@/components/InboxSidebar.vue'
import MessageList from '@/components/MessageList.vue'
import MessageReader from '@/components/MessageReader.vue'

const store = useInboxStore()
const assignees = useAssigneesStore()
const categories = useCategoriesStore()
const route = useRoute()
const router = useRouter()

const POLL_MS = 60000
let pollTimer = null

onMounted(async () => {
  assignees.loadAssigneesAction()
  categories.loadCategoriesAction()
  // Deep link: start the detail fetch before the list so the reader shows its
  // spinner right away instead of "inget meddelande valt" until the list lands.
  const deepLinkId = route.params.messageId
  if (deepLinkId) store.openMessageAction(deepLinkId).catch(() => {})
  await store.loadMessagesAction()
  // The list may have been fetched before the server marked the deep-linked
  // message read, so reflect it locally.
  if (deepLinkId) {
    const row = store.messages.find((m) => m.messageId === deepLinkId)
    if (row) row.status = 'read'
  }
  // Quietly check for new mail; skip when the tab is hidden. The silent refresh
  // never shows a spinner or touches the open message / composer draft.
  pollTimer = setInterval(() => {
    if (typeof document === 'undefined' || !document.hidden) {
      store.refreshMessagesAction()
    }
  }, POLL_MS)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

// Selected message lives in the URL (/m/:id) so reload/share works.
watch(
  () => route.params.messageId,
  (id) => {
    if (id && id !== store.current?.messageId) {
      store.openMessageAction(id)
      // Deep-linked from a notification while the app was already open: the
      // item may have arrived after the last poll, so it's missing from the
      // list. Pull a fresh list so it shows in the sidebar without a reload.
      if (!store.messages.some((m) => m.messageId === id)) {
        store.refreshMessagesAction()
      }
    }
    if (!id) store.current = null
  }
)

// Mobile drill: folders ← list (home) → reader. The reader level is driven by
// the URL (a message is open); folders vs list is local UI state.
const showFolders = ref(false)
const mobilePane = computed(() => {
  if (route.params.messageId) return 'reader'
  return showFolders.value ? 'folders' : 'list'
})

const paneTitle = computed(() => {
  if (store.filters.box === 'archived') return 'Arkiverade'
  return store.filters.category || 'Inkorg'
})

const STATE_LABELS = { open: 'Öppna', pending: 'Pågår', done: 'Klara' }
const ASSIGNMENT_LABELS = { mine: 'Mina', unassigned: 'Otilldelade' }

// Everything the sidebar can narrow the list by, named in the header - so the
// count below it is never unexplained.
const activeFilters = computed(() => {
  const { state, assignment, category, box } = store.filters
  return [
    // The category is the heading when it is the only scope; name it here too
    // when the heading is showing the archive instead.
    box === 'archived' && category ? category : null,
    STATE_LABELS[state],
    ASSIGNMENT_LABELS[assignment]
  ].filter(Boolean)
})

const debug = computed(
  () => new URLSearchParams(window.location.search).get('debug') === 'true'
)

const openMessage = (id) => router.push({ name: 'inbox-message', params: { messageId: id } })
const closeMessage = () => router.push({ name: 'inbox' })

// Picking anything in the folders pane drops back to the list on mobile.
const selectBox = (box) => {
  showFolders.value = false
  store.setBoxAction(box)
}
const selectCategory = (c) => {
  showFolders.value = false
  store.setCategory(c)
}
const selectState = (s) => {
  showFolders.value = false
  store.setStateFilter(s)
}
const selectAssignment = (a) => {
  showFolders.value = false
  store.setAssignment(a)
}

const onReply = async ({ body, close }) => {
  if (!store.current) return
  const id = store.current.messageId
  await store.replyAction(id, { body })
  if (close) await store.setStateAction(id, 'done')
  // Refresh the thread so the sent reply shows inline.
  await store.openMessageAction(id)
}

const onAddNote = async ({ text }) => {
  if (!store.current) return
  await store.addNoteAction(store.current.messageId, text)
}

const onSetState = async (state) => {
  if (!store.current) return
  await store.setStateAction(store.current.messageId, state)
}

const onSetAssignee = async (assignee) => {
  if (!store.current) return
  await store.setAssigneeAction(store.current.messageId, assignee)
}

// Wrong-alias fix: hand the issue to another category's team. It may leave this
// admin's scope entirely, so go back to the list rather than sitting on /m/:id
// re-fetching a message that can now 404.
const onTransfer = async (category) => {
  if (!store.current) return
  const id = store.current.messageId
  if (
    !window.confirm(
      `Flytta ärendet till ${category}? Ansvarig nollställs och ${category} meddelas.`
    )
  ) {
    return
  }
  await store.transferMessageAction(id, category)
  router.push({ name: 'inbox' })
}

const onDelete = async (id) => {
  if (!window.confirm('Ta bort detta ärende och alla svar permanent? Kan inte ångras.')) {
    return
  }
  await store.deleteMessageAction(id)
  router.push({ name: 'inbox' })
}

// Hand a Blob to the browser as a file save. iOS Safari needs the anchor in the
// document and the object URL still alive when the download starts, so revoking
// happens on a later tick rather than immediately.
const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const onDownloadRaw = async (id) => {
  const { raw, filename } = await store.fetchRawAction(id)
  saveBlob(new Blob([raw], { type: 'message/rfc822' }), filename || `${id}.eml`)
}

// `${messageId}:${index}` while a fetch is in flight, so the tapped chip can
// show progress instead of looking dead.
const attachmentBusy = ref(null)

// The attachment arrives base64 in JSON (the API needs our bearer token, so the
// browser can't just follow a link) — decode to bytes before saving, or the
// file lands corrupt.
const base64ToBlob = (base64, contentType) => {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: contentType || 'application/octet-stream' })
}

const onDownloadAttachment = async ({ messageId, index, filename }) => {
  const key = `${messageId}:${index}`
  if (attachmentBusy.value === key) return
  attachmentBusy.value = key
  try {
    const a = await store.fetchAttachmentAction(messageId, index)
    // Big attachments come back as a presigned S3 URL instead of base64 — the
    // bytes are too large for the API response.
    if (a.url) window.location.assign(a.url)
    else
      saveBlob(base64ToBlob(a.contentBase64, a.contentType), a.filename || filename || 'bilaga')
  } catch (e) {
    // Raw MIME eventually ages out of S3 (InboundObjectExpiryDays), taking the
    // bodies and attachments with it, so this 404 is permanent — say so instead
    // of failing silently. No retention figure here: it's a stack parameter and
    // a hardcoded number would quietly go stale the day it changes.
    window.alert(
      e?.code === 'NO_RAW' || e?.status === 404
        ? 'Bilagan finns inte kvar. Mejlet är för gammalt och har rensats.'
        : e?.message || 'Kunde inte hämta bilagan.'
    )
  } finally {
    attachmentBusy.value = null
  }
}
</script>
