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
      <button
        v-for="m in messages"
        :key="m.messageId"
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
  </div>
</template>

<script setup>
import EmptyState from '@/components/EmptyState.vue'
import Spinner from '@/components/Spinner.vue'
import { ago, senderName, stateLabel } from '@/helpers/format'

defineProps({
  messages: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
  loading: { type: Boolean, default: false }
})
defineEmits(['select'])

const assigneeInitials = (email) => (email ? email.slice(0, 2).toUpperCase() : '')
const name = (from) => senderName(from)
const initials = (from) => {
  const n = senderName(from)
  return (
    n
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}
</script>

<style scoped>
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
