<template>
  <RouterView v-if="isBare" />
  <div v-else class="app">
    <AppHeader />
    <RouterView />
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { useThemeStore } from '@/stores/theme-store'
import { useAdminSessionStore } from '@/stores/admin-session-store'

const route = useRoute()
const theme = useThemeStore()
const session = useAdminSessionStore()

onMounted(() => {
  theme.init()
  session.bootstrap()
})

// Login (and not-found) render without the app chrome.
const isBare = computed(() => ['login', 'not-found'].includes(String(route.name)))
</script>
