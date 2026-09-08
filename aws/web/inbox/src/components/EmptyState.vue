<template>
  <div class="empty" role="status">
    <div class="icon-bg" aria-hidden="true">{{ icon || '🐾' }}</div>
    <h3>{{ title }}</h3>
    <p v-if="description" class="muted">{{ description }}</p>
    <div v-if="$slots.actions" class="empty-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: String, default: '' }
})
</script>
