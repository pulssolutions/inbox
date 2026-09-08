<template>
  <div class="spinner-wrap" role="status" data-testid="spinner">
    <span class="spinner" aria-hidden="true" />
    <span v-if="label" class="spinner-label">{{ label }}</span>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, default: '' }
})
</script>

<style scoped>
.spinner-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 24px;
  color: var(--fg-3);
}
.spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 3px solid var(--border-2);
  border-top-color: var(--accent);
  animation: spin 0.7s linear infinite;
}
.spinner-label {
  font-size: 0.86rem;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
