<template>
  <button
    type="button"
    class="theme-btn"
    :aria-label="label"
    :title="label"
    @click="store.toggle()"
  >
    <span aria-hidden="true">{{ icon }}</span>
    <span class="theme-btn__text">{{ text }}</span>
  </button>
</template>

<script setup>
import { computed } from 'vue'
import { useThemeStore } from '@/stores/theme-store'

const store = useThemeStore()
const isDark = computed(() => store.effectiveTheme === 'dark')
const icon = computed(() => (isDark.value ? '☀' : '☾'))
const text = computed(() => (isDark.value ? 'Ljust' : 'Mörkt'))
const label = computed(() => `Byt till ${isDark.value ? 'ljust' : 'mörkt'} läge`)
</script>

<style scoped>
.theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid var(--border-2);
  color: var(--fg-2);
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 500;
}
.theme-btn:hover {
  background: var(--bg-3);
}
</style>
