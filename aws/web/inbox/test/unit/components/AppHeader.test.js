import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import { useAdminSessionStore } from '@/stores/admin-session-store'

const buildRouter = () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'inbox', component: { template: '<div/>' } },
      { path: '/admins', name: 'admins', component: { template: '<div/>' } },
      { path: '/audit', name: 'audit', component: { template: '<div/>' } },
      { path: '/logga-in', name: 'login', component: { template: '<div/>' } }
    ]
  })
  router.push('/')
  return router
}

const grant = (session, caps) => {
  session.orgs = { acme: { capabilities: { inbox: { read: true }, ...caps }, active: true } }
  session.currentOrg = 'acme'
  session.idToken = 'x'
}

describe('AppHeader', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('renders the brand and Inkorg nav', async () => {
    const router = buildRouter()
    await router.isReady()
    const w = mount(AppHeader, { global: { plugins: [router] } })
    expect(w.text()).toContain('Acme')
    expect(w.text()).toContain('Inkorg')
  })

  it('shows the Admins nav only for users with admins.read', async () => {
    const router = buildRouter()
    await router.isReady()
    const noAdmin = mount(AppHeader, { global: { plugins: [router] } })
    expect(noAdmin.find('[data-testid="nav-admins"]').exists()).toBe(false)

    const session = useAdminSessionStore()
    grant(session, { admins: { read: true } })
    const withAdmin = mount(AppHeader, { global: { plugins: [router] } })
    expect(withAdmin.find('[data-testid="nav-admins"]').exists()).toBe(true)
  })

  it('shows the Logg nav only for users with audit.read', async () => {
    const router = buildRouter()
    await router.isReady()
    const session = useAdminSessionStore()
    grant(session, { audit: { read: true } })
    const w = mount(AppHeader, { global: { plugins: [router] } })
    expect(w.find('[data-testid="nav-audit"]').exists()).toBe(true)
  })

  it('debounced topbar search calls the inbox store', async () => {
    vi.useFakeTimers()
    const router = buildRouter()
    await router.isReady()
    const w = mount(AppHeader, { global: { plugins: [router] } })
    const { useInboxStore } = await import('@/stores/inbox-store')
    const spy = vi.spyOn(useInboxStore(), 'searchAction').mockResolvedValue()
    const input = w.find('[data-testid="search-input"]')
    expect(input.exists()).toBe(true)
    await input.setValue('valpkurs')
    vi.advanceTimersByTime(300)
    expect(spy).toHaveBeenCalledWith('valpkurs')
    vi.useRealTimers()
  })

  it('logout clears the session and routes to login', async () => {
    const router = buildRouter()
    await router.isReady()
    const session = useAdminSessionStore()
    const spy = vi.spyOn(session, 'signOut')
    const w = mount(AppHeader, { global: { plugins: [router] } })
    await w.find('[data-testid="logout"]').trigger('click')
    await flushPromises()
    expect(spy).toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('login')
  })
})
