import { createRouter, createWebHashHistory } from 'vue-router'
import { useAdminSessionStore, setSignedOutHandler } from '@/stores/admin-session-store'
import { BRAND } from '@/config'

const routes = [
  {
    path: '/logga-in',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: `Logga in · ${BRAND.short} ${BRAND.tagline}` }
  },
  {
    path: '/',
    name: 'inbox',
    component: () => import('@/views/InboxView.vue'),
    meta: {
      title: `Inkorg · ${BRAND.short}`,
      requiresAdmin: true,
      requiresCapability: 'inbox.read'
    }
  },
  {
    path: '/m/:messageId',
    name: 'inbox-message',
    component: () => import('@/views/InboxView.vue'),
    meta: {
      title: `Inkorg · ${BRAND.short}`,
      requiresAdmin: true,
      requiresCapability: 'inbox.read'
    }
  },
  {
    path: '/admins',
    name: 'admins',
    component: () => import('@/views/AdminsView.vue'),
    meta: {
      title: `Administratörer · ${BRAND.short}`,
      requiresAdmin: true,
      requiresCapability: 'admins.read'
    }
  },
  {
    path: '/audit',
    name: 'audit',
    component: () => import('@/views/AuditView.vue'),
    meta: {
      title: `Logg · ${BRAND.short}`,
      requiresAdmin: true,
      requiresCapability: 'audit.read'
    }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: `404 · ${BRAND.short} ${BRAND.tagline}` }
  }
]

const router = createRouter({
  // Hash history keeps every real URL at the app root (e.g. /inbox/#/m/123), so a
  // single shared CloudFront origin can host the SPA at any path prefix without
  // per-path rewrite rules. import.meta.env.BASE_URL carries the deploy prefix.
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.beforeEach((to) => {
  if (to.meta?.requiresAdmin) {
    const session = useAdminSessionStore()
    if (!session.isAuthenticated) session.bootstrap()
    if (!session.isAuthenticated || !session.organizationId) {
      return { name: 'login', query: { redirect: to.fullPath } }
    }
    const cap = to.meta?.requiresCapability
    if (cap && !session.can(cap)) {
      // Authenticated but lacks the capability → send to the inbox, not login.
      return session.can('inbox.read') ? { name: 'inbox' } : { name: 'login' }
    }
  }
  return true
})

// A session that dies mid-visit (expired refresh token, revoked membership)
// otherwise leaves the admin on empty app chrome until they reload.
setSignedOutHandler(() => {
  const current = router.currentRoute.value
  if (!current.meta?.requiresAdmin) return
  router.replace({ name: 'login', query: { redirect: current.fullPath } })
})

router.afterEach((to) => {
  if (to.meta?.title) document.title = to.meta.title
})

export default router
