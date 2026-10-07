<template>
  <div class="pane-body">
    <Spinner v-if="loading" label="Laddar…" />
    <EmptyState
      v-else-if="messages.length === 0"
      title="Inga meddelanden"
      description="Den här inkorgen är tom."
      icon="📭"
    />
    <div v-else class="list" data-testid="message-list">
      <div class="bulk-bar">
        <input
          type="checkbox"
          class="li-check"
          data-testid="select-all"
          aria-label="Markera alla"
          :checked="allSelected"
          :indeterminate="selected.length > 0 && !allSelected"
          @change="$emit('update:selected', $event.target.checked ? messages.map((m) => m.messageId) : [])"
        />
        <template v-if="selected.length">
          <span class="muted">{{ selected.length }} markerade</span>
          <span class="topbar-spacer" />
          <button
            v-if="box !== 'archived'"
            type="button"
            class="btn btn-secondary btn-sm"
            data-testid="bulk-archive"
            @click="$emit('bulk', { box: 'archived' })"
          >
            Arkivera
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            data-testid="bulk-done"
            @click="$emit('bulk', { state: 'done' })"
          >
            Markera klar
          </button>
        </template>
        <span v-else class="muted">Markera alla</span>
      </div>
      <div v-for="m in messages" :key="m.messageId" class="list-row">
        <input
          type="checkbox"
          class="li-check"
          data-testid="select-row"
          :aria-label="`Markera ${m.subject || name(m.from)}`"
          :checked="selected.includes(m.messageId)"
          @change="toggle(m.messageId, $event.target.checked)"
        />
        <button
          type="button"
          class="list-item"
          :class="{ active: selectedId === m.messageId, unread: m.status === 'unread' }"
          @click="$emit('select', m.messageId)"
        >
          <span class="av av-sm">{{ initials(m.from) }}</span>
          <span class="li-main">
            <span class="li-from">{{ name(m.from) }}</span>
            <span class="li-subj">{{ m.subject || '(inget ämne)' }}</span>
          </span>
          <span class="li-meta">
            <span class="li-row">
              <span>{{ ago(m.lastActivityAt || m.receivedAt) }}</span>
              <span
                v-if="m.assignee"
                class="av av-sm assignee-av"
                :title="`Tilldelad: ${m.assignee}`"
              >{{ assigneeInitials(m.assignee) }}</span>
            </span>
            <span class="badge" :class="`state-${m.state || 'open'}`">
              {{ stateLabel(m.state) }}
            </span>
            <span class="li-cat">{{ m.category }}</span>
          </span>
        </button>
      </div>
      <div v-if="hasPrev || hasNext" class="pager muted" data-testid="pager">
        <span>{{ start + 1 }}–{{ start + messages.length }}</span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          data-testid="page-prev"
          aria-label="Föregående sida"
          :disabled="!hasPrev"
          @click="$emit('prev')"
        >
          ‹
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          data-testid="page-next"
          aria-label="Nästa sida"
          :disabled="!hasNext"
          @click="$emit('next')"
        >
          ›
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import EmptyState from '@/components/EmptyState.vue'
import Spinner from '@/components/Spinner.vue'
import { computed } from 'vue'
import { ago, initials, senderName, stateLabel } from '@/helpers/format'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
  loading: { type: Boolean, default: false },
  // Ticked rows for bulk actions - not the open message (selectedId).
  selected: { type: Array, default: () => [] },
  box: { type: String, default: 'inbox' },
  // Paging is the server's; the list only shows where it is and asks to move.
  start: { type: Number, default: 0 },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false }
})
const emit = defineEmits(['select', 'update:selected', 'bulk', 'prev', 'next'])

const allSelected = computed(
  () => props.messages.length > 0 && props.messages.every((m) => props.selected.includes(m.messageId))
)
const toggle = (id, on) =>
  emit('update:selected', on ? [...props.selected, id] : props.selected.filter((s) => s !== id))

const assigneeInitials = (email) => (email ? email.slice(0, 2).toUpperCase() : '')
const name = (from) => senderName(from)
</script>

<style scoped>
.bulk-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 6px 16px 6px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 0.82rem;
}
.list-row {
  position: relative;
}
/* Sits over the row button's widened left padding, so the row keeps one
   background for hover and the open message. */
.list-row .li-check {
  position: absolute;
  left: 12px;
  top: 16px;
  z-index: 1;
}
.list-row .list-item {
  padding-left: 36px;
}
.li-check {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px;
  font-size: 0.82rem;
}
.li-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.assignee-av {
  background: var(--bg-3);
  color: var(--fg-2);
}
</style>
