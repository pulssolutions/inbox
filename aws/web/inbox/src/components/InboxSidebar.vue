<template>
  <aside class="pane pane-side">
    <div class="pane-head folders-head d-md-none">
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        data-testid="folders-back"
        @click="$emit('close')"
      >
        ← Inkorg
      </button>
      <h2>Mappar</h2>
    </div>
    <div class="pane-body">
      <div class="side-section">
        <button
          type="button"
          class="side-link"
          :class="{ active: box === 'inbox' && assignment === 'all' && !category }"
          @click="$emit('select-box', 'inbox')"
        >
          Inkorg
          <span class="count">{{ inboxTotal }}</span>
        </button>
        <button
          type="button"
          class="side-link"
          :class="{ active: assignment === 'mine' }"
          data-testid="filter-mine"
          @click="$emit('select-assignment', 'mine')"
        >
          Mina ärenden
        </button>
        <button
          type="button"
          class="side-link"
          :class="{ active: assignment === 'unassigned' }"
          data-testid="filter-unassigned"
          @click="$emit('select-assignment', 'unassigned')"
        >
          Ej tilldelade
        </button>
        <button
          type="button"
          class="side-link"
          :class="{ active: box === 'archived' }"
          @click="$emit('select-box', 'archived')"
        >
          Arkiverade
        </button>
      </div>

      <div class="side-section">
        <div class="side-label">Status</div>
        <div class="status-pills">
          <button
            v-for="p in statusPills"
            :key="p.value ?? 'all'"
            type="button"
            class="pill"
            :class="{ active: (state || null) === p.value }"
            :data-testid="`state-${p.value || 'all'}`"
            @click="$emit('select-state', p.value)"
          >
            {{ p.label }}
          </button>
        </div>
      </div>

      <div v-if="box === 'inbox'" class="side-section">
        <div class="side-label">Kategorier</div>
        <button
          v-for="c in categories"
          :key="c.name"
          type="button"
          class="side-link"
          :class="{ active: category === c.name }"
          @click="$emit('select-category', category === c.name ? null : c.name)"
        >
          <span class="swatch" :style="{ background: swatch(c.name) }" />
          <span class="cat-name">{{ c.name }}</span>
          <span class="count">{{ c.count }}</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  box: { type: String, default: 'inbox' },
  category: { type: String, default: null },
  state: { type: String, default: null },
  assignment: { type: String, default: 'all' },
  categories: { type: Array, default: () => [] }
})
defineEmits(['select-box', 'select-category', 'select-state', 'select-assignment', 'close'])

const statusPills = [
  { value: null, label: 'Alla' },
  { value: 'open', label: 'Öppen' },
  { value: 'pending', label: 'Pågår' },
  { value: 'done', label: 'Klar' }
]

const inboxTotal = computed(() => props.categories.reduce((n, c) => n + c.count, 0))

const swatch = (name) => {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${h} 55% 55%)`
}
</script>

<style scoped>
.cat-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.status-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 4px 10px 6px;
}
</style>
