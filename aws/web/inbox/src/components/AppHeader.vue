<template>
  <header class="topbar">
    <RouterLink to="/" class="brand">
      <img :src="logo" alt="" class="brand-logo" @error="brandLogoBroken = true" />
      <b class="d-none d-sm-inline">{{ BRAND.short }}</b>
      <span class="d-none d-md-inline">{{ BRAND.tagline }}</span>
    </RouterLink>
    <nav>
      <RouterLink to="/" :class="{ active: isInbox }">Inkorg</RouterLink>
      <RouterLink
        v-if="canManageAdmins"
        to="/admins"
        data-testid="nav-admins"
        :class="{ active: route.name === 'admins' }"
      >
        Admins
      </RouterLink>
      <RouterLink
        v-if="canViewAudit"
        to="/audit"
        data-testid="nav-audit"
        :class="{ active: route.name === 'audit' }"
      >
        Logg
      </RouterLink>
    </nav>
    <div v-if="showSearch" class="topbar-search">
      <input
        v-model="q"
        type="search"
        class="form-control"
        data-testid="search-input"
        placeholder="Sök ärenden…"
        @input="onSearch"
      />
    </div>
    <span class="topbar-spacer" />
    <ThemeToggle />
    <div class="topbar-user">
      <span class="av av-sm" :title="user?.email || ''">{{ initials }}</span>
      <button
        type="button"
        class="icon-btn"
        data-testid="logout"
        title="Logga ut"
        @click="logout"
      >
        Logga ut
      </button>
    </div>
  </header>
</template>

<script setup>
import { computed, ref } from 'vue'
import { RouterLink, useRouter, useRoute } from 'vue-router'
import { useAdminSessionStore } from '@/stores/admin-session-store'
import { useInboxStore } from '@/stores/inbox-store'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { BRAND } from '@/config'
import fallbackLogo from '@/assets/images/logo.svg'
import { useThemeStore } from '@/stores/theme-store'

const router = useRouter()
const route = useRoute()
const session = useAdminSessionStore()
const inbox = useInboxStore()
// Two artworks rather than an invert() filter: the mark's orange is part of
// the brand, and inverting it turns it blue.
const theme = useThemeStore()
// Brand artwork comes from the deployment profile (staged under /brand at
// build time). No configured logo -> the product's own neutral mark.
const brandLogoBroken = ref(false)
const logo = computed(() => {
  const configured = theme.effectiveTheme === 'dark' ? BRAND.logoDark : BRAND.logo
  // Fall back when the artwork is unset OR fails to load: a profile pointing at
  // a path that was never staged would otherwise render a 0-width broken image
  // rather than the product's own mark.
  return configured && !brandLogoBroken.value ? configured : fallbackLogo
})
const user = computed(() => session.user)
const canManageAdmins = computed(() => session.can('admins.read'))
const canViewAudit = computed(() => session.can('audit.read'))
// Reading an individual message is still "in the inbox", so the deep-linked
// route keeps the Inkorg tab lit.
const isInbox = computed(() => ['inbox', 'inbox-message'].includes(route.name))

// Search lives in the topbar but only applies on the inbox views.
const showSearch = computed(() => ['inbox', 'inbox-message'].includes(String(route.name)))
const q = ref('')
let searchTimer = null
const onSearch = () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => inbox.searchAction(q.value), 250)
}
const initials = computed(
  () => session.user?.initials || (session.user?.email || '?').slice(0, 1).toUpperCase()
)

const logout = () => {
  session.signOut()
  router.push({ name: 'login' })
}
</script>

<style scoped>
.brand {
  text-decoration: none;
  color: inherit;
}
.topbar-search {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
}
.topbar-search .form-control {
  font-size: 0.86rem;
  padding: 6px 11px;
}
.topbar-user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 8px;
  border-left: 1px solid var(--border);
}
/* Phones: search drops to its own full-width row; user controls stay top-right. */
@media (max-width: 767.98px) {
  .topbar-search {
    order: 5;
    flex: 1 0 100%;
    max-width: none;
  }
  .topbar-user {
    margin-left: auto;
  }
}
</style>
