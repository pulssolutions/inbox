<template>
  <section class="pane pane-reader">
    <Spinner v-if="loading" label="Laddar meddelande…" />
    <EmptyState
      v-else-if="!message"
      title="Inget meddelande valt"
      description="Välj ett meddelande i listan för att läsa och svara."
      icon="✉️"
    />
    <template v-else>
      <div class="reader-head">
        <h1>{{ message.subject || '(inget ämne)' }}</h1>
        <div class="reader-meta">
          <span class="from-pill">
            <span class="av av-sm">{{ initialsOf(message.from) }}</span>
            <b>{{ nameOf(message.from) }}</b>
            <span v-if="emailAddr" class="from-email" data-testid="from-email">&lt;{{ emailAddr }}&gt;</span>
          </span>
          <span class="li-cat">{{ message.category }}</span>
        </div>
      </div>

      <div class="reader-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-testid="back" @click="$emit('back')">
          ← Tillbaka
        </button>
        <button
          v-if="debug"
          type="button"
          class="btn btn-ghost btn-sm"
          data-testid="download-raw"
          @click="$emit('download-raw', message.messageId)"
        >
          ⬇ Ladda ner RAW
        </button>
        <span class="topbar-spacer" />
        <select
          class="form-control state-select"
          data-testid="assignee-select"
          :value="message.assignee || ''"
          @change="$emit('set-assignee', $event.target.value || null)"
        >
          <option value="">Ej tilldelad</option>
          <option v-for="a in assignees" :key="a.email" :value="a.email">
            {{ a.name || a.email }}
          </option>
        </select>
        <select
          class="form-control state-select"
          data-testid="category-select"
          :value="message.category"
          @change="onCategoryChange"
        >
          <option v-for="c in categoryOptions" :key="c" :value="c">{{ c }}</option>
        </select>
        <select
          class="form-control state-select"
          data-testid="state-select"
          :value="message.state || 'open'"
          @change="$emit('set-state', $event.target.value)"
        >
          <option v-for="s in STATES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
        <button
          v-if="message.box !== 'archived'"
          type="button"
          class="btn btn-secondary btn-sm"
          data-testid="archive"
          @click="$emit('archive', message.messageId)"
        >
          Arkivera
        </button>
        <template v-else>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            data-testid="unarchive"
            @click="$emit('unarchive', message.messageId)"
          >
            Återställ
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-delete"
            data-testid="delete"
            @click="$emit('delete', message.messageId)"
          >
            Ta bort permanent
          </button>
        </template>
      </div>

      <div class="thread">
        <template v-for="item in timeline" :key="item.key">
          <!-- inbound/outbound message -->
          <div
            v-if="item.type === 'message'"
            class="msg"
            :class="item.m.direction"
            data-testid="thread-msg"
          >
            <span class="av">{{ initialsOf(item.m.from) }}</span>
            <div class="body">
              <div class="body-head">
                <b>{{ nameOf(item.m.from) }}</b>
                <span v-if="item.m.direction === 'outbound'" class="badge badge-accent">Skickat svar</span>
                <span v-if="item.m.sentByName" class="muted" data-testid="sent-by">av {{ item.m.sentByName }}</span>
                <span class="muted">{{ formatDateTime(item.m.receivedAt) }}</span>
              </div>
              <!-- eslint-disable-next-line vue/no-v-html -- sanitized via DOMPurify -->
              <div v-if="htmlOf(item.m)" class="body-html" v-html="htmlOf(item.m)" />
              <div v-else class="body-text">{{ item.m.text }}</div>
              <div v-if="(item.m.attachments || []).length" class="attachments">
                <!-- A real button, not a chip: the file has to be fetched with the
                     admin's bearer token and rebuilt client-side, so there's no
                     href to hand the browser. -->
                <button
                  v-for="(a, i) in item.m.attachments"
                  :key="i"
                  type="button"
                  class="attachment"
                  data-testid="attachment"
                  :disabled="attachmentBusy === `${item.m.messageId}:${i}`"
                  :title="`Hämta ${a.filename || 'bilaga'}`"
                  @click="$emit('download-attachment', { messageId: item.m.messageId, index: i, filename: a.filename })"
                >
                  <span aria-hidden="true">📎</span>
                  <span class="attachment-name">{{ a.filename || 'bilaga' }}</span>
                  <span class="attachment-meta">{{
                    attachmentBusy === `${item.m.messageId}:${i}` ? 'Hämtar…' : formatBytes(a.size)
                  }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- internal note -->
          <div v-else class="msg note" data-testid="note">
            <span class="av">📝</span>
            <div class="body">
              <div class="body-head">
                <b>{{ item.n.authorName || item.n.author }}</b>
                <span class="muted">{{ formatDateTime(item.n.createdAt) }}</span>
              </div>
              <div class="body-text">{{ item.n.text }}</div>
            </div>
          </div>
        </template>
      </div>

      <div class="mobile-reply-bar">
        <button
          type="button"
          class="btn btn-primary btn-reply"
          data-testid="mobile-reply"
          @click="openComposer('reply')"
        >
          Svara via mejl
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-reply"
          data-testid="mobile-note"
          @click="openComposer('note')"
        >
          Anteckning
        </button>
      </div>

      <div class="composer" :class="{ 'composer-open': composerOpen }">
        <div class="composer-mobile-bar d-md-none">
          <span class="topbar-spacer" />
          <button type="button" class="btn btn-ghost btn-sm" data-testid="composer-close" @click="composerOpen = false">
            ✕ Stäng
          </button>
        </div>
        <div class="composer-tabs">
          <button type="button" :class="{ active: mode === 'reply' }" data-testid="tab-reply" @click="mode = 'reply'">
            Svar via mejl
          </button>
          <button
            type="button"
            :class="{ active: mode === 'note', note: mode === 'note' }"
            data-testid="tab-note"
            @click="mode = 'note'"
          >
            Intern anteckning
          </button>
        </div>
        <textarea
          v-model="draft"
          class="form-control"
          data-testid="reply-body"
          :placeholder="
            mode === 'note'
              ? 'Skriv en intern anteckning (syns bara internt)…'
              : `Svara ${nameOf(message.from)}…`
          "
        />
        <div class="composer-bar">
          <span class="topbar-spacer" />
          <button
            v-if="mode === 'note'"
            type="button"
            class="btn btn-primary btn-sm"
            data-testid="save-note"
            :disabled="!draft.trim() || replying"
            @click="send"
          >
            {{ replying ? 'Sparar…' : 'Spara anteckning' }}
          </button>
          <div v-else class="split-btn">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              data-testid="send-reply"
              :disabled="!draft.trim() || replying"
              @click="send"
            >
              {{ replying ? 'Skickar…' : closeAfter ? 'Skicka och stäng' : 'Skicka och lämna öppen' }}
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm split-caret"
              data-testid="send-menu-toggle"
              :disabled="replying"
              :aria-expanded="menuOpen"
              aria-haspopup="menu"
              aria-label="Fler alternativ för att skicka"
              @click="menuOpen = !menuOpen"
            >
              <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <path
                  d="M3 4.75 L6 7.75 L9 4.75"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <div v-if="menuOpen" class="send-menu">
              <button type="button" class="menu-item" data-testid="opt-close" @click="choose(true)">
                Skicka och stäng
              </button>
              <button type="button" class="menu-item" data-testid="opt-open" @click="choose(false)">
                Skicka och lämna öppen
              </button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        :open="confirmOpen"
        title="Skicka svar och stäng ärendet?"
        @close="confirmOpen = false"
      >
        <div class="alert alert-warning mb-0" data-testid="confirm-send-close-body">
          <p class="mb-1">
            Ditt svar skickas till <strong>{{ nameOf(message.from) }}</strong>.
          </p>
          <p class="mb-0">
            Ärendet markeras sedan som <strong>klart</strong> och stängs.
          </p>
        </div>
        <template #footer>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            data-testid="confirm-cancel"
            @click="confirmOpen = false"
          >
            Avbryt
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            data-testid="confirm-send-close"
            :disabled="replying"
            @click="doSend"
          >
            Skicka och stäng
          </button>
        </template>
      </Modal>
    </template>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import EmptyState from '@/components/EmptyState.vue'
import Spinner from '@/components/Spinner.vue'
import Modal from '@/components/Modal.vue'
import {
  formatDateTime,
  formatBytes,
  senderName,
  emailOf,
  STATES
} from '@/helpers/format'

const props = defineProps({
  message: { type: Object, default: null },
  replying: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  debug: { type: Boolean, default: false },
  assignees: { type: Array, default: () => [] },
  // Every category the org knows about — the transfer targets.
  categories: { type: Array, default: () => [] },
  // `${messageId}:${index}` of the attachment currently being fetched, so the
  // tapped chip can say so — on mobile the download is otherwise silent for a
  // second or two and looks like nothing happened.
  attachmentBusy: { type: String, default: null }
})
const emit = defineEmits([
  'archive',
  'unarchive',
  'delete',
  'reply',
  'back',
  'download-raw',
  'download-attachment',
  'set-state',
  'set-assignee',
  'add-note',
  'transfer'
])

// The current category always shows, even if it is not in the org list yet.
const categoryOptions = computed(() => {
  const all = new Set(props.categories)
  if (props.message?.category) all.add(props.message.category)
  return [...all].sort((a, b) => a.localeCompare(b, 'sv'))
})

// The select is not bound to state: the parent confirms first and may cancel,
// and the prop only changes once the transfer actually goes through. Reset it
// so a cancelled move doesn't leave the wrong category showing.
const onCategoryChange = (e) => {
  const to = e.target.value
  e.target.value = props.message.category
  if (to !== props.message.category) emit('transfer', to)
}

const draft = ref('')
const mode = ref('reply') // 'reply' | 'note'
const closeAfter = ref(true) // default: send and close
const menuOpen = ref(false)
const composerOpen = ref(false) // mobile: composer hidden until opened
const confirmOpen = ref(false) // "Skicka och stäng" confirmation dialog

watch(
  () => props.message?.messageId,
  () => {
    draft.value = ''
    mode.value = 'reply'
    menuOpen.value = false
    composerOpen.value = false
    confirmOpen.value = false
  }
)

// Mobile "Svara"/"Anteckning" triggers — pick the tab and reveal the sheet.
const openComposer = (m) => {
  mode.value = m
  composerOpen.value = true
}

const thread = computed(() => props.message?.thread || [])
const notes = computed(() => props.message?.notes || [])

// Messages + notes interleaved into one chronological timeline (oldest first).
const timeline = computed(() => {
  const items = [
    ...thread.value.map((m) => ({ type: 'message', ts: m.receivedAt, key: 'm:' + m.messageId, m })),
    ...notes.value.map((n) => ({ type: 'note', ts: n.createdAt, key: 'n:' + n.createdAt, n }))
  ]
  return items.sort((a, b) => ((a.ts || '') < (b.ts || '') ? -1 : 1))
})

const emailAddr = computed(() => emailOf(props.message?.from || ''))
const nameOf = (from) => senderName(from || '')
const initialsOf = (from) =>
  nameOf(from)
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

// Sanitize the HTML part (keeps inline colour, strips scripts/handlers).
const htmlOf = (member) =>
  member.html ? DOMPurify.sanitize(member.html, { FORBID_TAGS: ['style'], ADD_ATTR: ['target'] }) : null

const send = () => {
  const text = draft.value.trim()
  if (!text) return
  menuOpen.value = false
  // Sending a reply that also closes the issue is irreversible from here, so
  // confirm first. Notes and "send and leave open" go through immediately.
  if (mode.value === 'reply' && closeAfter.value) {
    confirmOpen.value = true
    return
  }
  doSend()
}

const doSend = () => {
  const text = draft.value.trim()
  if (!text) return
  menuOpen.value = false
  composerOpen.value = false
  confirmOpen.value = false
  if (mode.value === 'note') {
    emit('add-note', { text })
  } else {
    emit('reply', { body: text, close: closeAfter.value })
  }
  draft.value = ''
}

const choose = (close) => {
  closeAfter.value = close
  send()
}
</script>

<style scoped>
.from-email {
  color: var(--fg-3);
  font-size: 0.85rem;
  font-weight: 400;
}
.composer-mobile-bar {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.btn-delete {
  color: var(--danger);
}
.btn-delete:hover {
  background: var(--danger-bg);
}
.split-btn {
  position: relative;
  display: inline-flex;
}
.split-caret {
  /* Vertical padding stays inherited from .btn-sm so both halves are exactly
     the same height; only the horizontal padding is set here. */
  padding-inline: 9px;
  /* Seam derived from the button's foreground, so it reads on the accent fill
     in both themes rather than being a fixed black mix. */
  border-left: 1px solid color-mix(in srgb, var(--accent-fg) 30%, transparent);
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
.split-caret svg {
  width: 12px;
  height: 12px;
  display: block;
  /* Driven by aria-expanded rather than a parallel class, so what is drawn and
     what is announced cannot disagree. */
  transition: transform 160ms cubic-bezier(0.2, 0.7, 0.3, 1);
}
.split-caret[aria-expanded='true'] svg {
  transform: rotate(180deg);
}
@media (prefers-reduced-motion: reduce) {
  .split-caret svg {
    transition: none;
  }
}
.split-btn > .btn:first-child {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.send-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 4px;
  min-width: 210px;
  z-index: 20;
}
.send-menu .menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 0.86rem;
  color: var(--fg-2);
  cursor: pointer;
}
.send-menu .menu-item:hover {
  background: var(--bg-3);
  color: var(--fg);
}
</style>
