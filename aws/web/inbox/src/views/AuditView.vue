<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Logg</h1>
        <p class="muted">Vem gjorde vad och när.</p>
      </div>
    </div>

    <div class="page-body">
      <Spinner v-if="store.loading.list" label="Laddar logg…" />
      <table v-else class="admin-table">
        <thead>
          <tr>
            <th>Tid</th>
            <th>Vem</th>
            <th>Vad</th>
            <th>Mål</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="e in store.entries" :key="e.id">
            <tr data-testid="audit-row">
              <td class="muted nowrap">{{ formatDateTime(e.ts) }}</td>
              <td>{{ actorName(e) }}</td>
              <td>{{ auditActionLabel(e.action) }}</td>
              <td class="muted">{{ e.targetLabel || e.targetId || '—' }}</td>
              <td class="nowrap">
                <button
                  v-if="auditDetail(e)"
                  type="button"
                  class="btn btn-ghost btn-sm disclosure"
                  data-testid="audit-details-toggle"
                  :aria-expanded="expanded.has(e.id)"
                  @click="toggle(e.id)"
                >
                  Detaljer
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
              </td>
            </tr>
            <tr v-if="expanded.has(e.id)" data-testid="audit-details">
              <td />
              <td colspan="4" class="muted detail-cell">{{ auditDetail(e) }}</td>
            </tr>
          </template>
          <tr v-if="!store.entries.length">
            <td colspan="5" class="muted">Inga händelser ännu.</td>
          </tr>
        </tbody>
      </table>
      <p v-if="store.error.list" class="form-error">Kunde inte ladda loggen.</p>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive } from 'vue'
import { useAuditStore } from '@/stores/audit-store'
import Spinner from '@/components/Spinner.vue'
import { formatDateTime, auditActionLabel, auditDetail } from '@/helpers/format'

const store = useAuditStore()
onMounted(() => store.loadAuditAction())

const expanded = reactive(new Set())
const toggle = (id) => (expanded.has(id) ? expanded.delete(id) : expanded.add(id))

const actorName = (e) => e.actor?.name || e.actor?.email || 'okänd'
</script>

<style scoped>
.page {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.page-head {
  padding: 22px 28px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-2);
}
.page-body {
  padding: 22px 28px;
}
/* Same chevron and the same aria-expanded hook as the reply split button, so
   the app has one disclosure shape rather than a set of look-alike glyphs.
   Collapsed points right; open points down. */
.disclosure svg {
  width: 12px;
  height: 12px;
  display: block;
  transition: transform 160ms cubic-bezier(0.2, 0.7, 0.3, 1);
}
.disclosure[aria-expanded='false'] svg {
  transform: rotate(-90deg);
}
@media (prefers-reduced-motion: reduce) {
  .disclosure svg {
    transition: none;
  }
}
</style>
