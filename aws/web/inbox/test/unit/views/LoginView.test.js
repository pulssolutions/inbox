import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('@/auth/cognito', () => ({
  beginSignIn: vi.fn().mockResolvedValue(),
  handleCallback: vi.fn(),
  refreshTokens: vi.fn(),
  buildSignOutUrl: () => 'https://example/logout'
}))

import LoginView from '@/views/LoginView.vue'
import { useAdminSessionStore } from '@/stores/admin-session-store'
import * as cognito from '@/auth/cognito'

const orgs = {
  acme: {
    capabilities: { inbox: { read: true, write: true, send: true } },
    active: true
  }
}

const session = (over = {}) => ({
  idToken: 'id',
  accessToken: 'at',
  refreshToken: 'rt',
  expiresAt: Date.now() + 3600_000,
  claims: {},
  currentOrg: 'acme',
  orgs,
  user: { email: 'a@x', name: 'A', organizationId: 'acme', initials: 'A' },
  ...over
})

const buildRouter = (initial = '/logga-in') => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'inbox', component: { template: '<div>Inbox</div>' } },
      { path: '/logga-in', name: 'login', component: LoginView }
    ]
  })
  router.push(initial)
  return router
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('renders the Google sign-in button', async () => {
    const router = buildRouter()
    await router.isReady()
    const w = mount(LoginView, { global: { plugins: [router] } })
    expect(w.find('[data-testid="google-signin"]').exists()).toBe(true)
  })

  it('clicking sign-in begins the Hosted UI redirect', async () => {
    const router = buildRouter()
    await router.isReady()
    const w = mount(LoginView, { global: { plugins: [router] } })
    await w.find('[data-testid="google-signin"]').trigger('click')
    await flushPromises()
    expect(cognito.beginSignIn).toHaveBeenCalledOnce()
  })

  it('?code= completes the session and redirects to the inbox', async () => {
    cognito.handleCallback.mockResolvedValueOnce(session())
    const router = buildRouter('/logga-in?code=abc&state=def')
    await router.isReady()
    mount(LoginView, { global: { plugins: [router] } })
    await flushPromises()
    expect(cognito.handleCallback).toHaveBeenCalledWith({ code: 'abc', state: 'def' })
    expect(useAdminSessionStore().isAuthenticated).toBe(true)
    expect(router.currentRoute.value.name).toBe('inbox')
  })

  it('shows the no-access message on AUTH_NO_ORG', async () => {
    cognito.handleCallback.mockRejectedValueOnce(new Error('AUTH_NO_ORG'))
    const router = buildRouter('/logga-in?code=abc&state=def')
    await router.isReady()
    const w = mount(LoginView, { global: { plugins: [router] } })
    await flushPromises()
    expect(w.find('[data-testid="no-access"]').exists()).toBe(true)
  })

  it('shows an org picker for multi-org users and selecting one enters the inbox', async () => {
    cognito.handleCallback.mockResolvedValueOnce({
      idToken: 'id',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3600_000,
      claims: {},
      orgs: {
        acme: { capabilities: { inbox: { read: true } }, name: 'Acme BK' },
        hundklubben: { capabilities: { inbox: { read: true } }, name: 'Hundklubben' }
      },
      user: { email: 'a@x', name: 'A', initials: 'A' }
    })
    const router = buildRouter('/logga-in?code=abc&state=def')
    await router.isReady()
    const w = mount(LoginView, { global: { plugins: [router] } })
    await flushPromises()
    const opts = w.findAll('[data-testid="org-option"]')
    expect(opts).toHaveLength(2)
    await opts[1].trigger('click') // Hundklubben
    await flushPromises()
    const s = useAdminSessionStore()
    expect(s.currentOrg).toBe('hundklubben')
    expect(router.currentRoute.value.name).toBe('inbox')
  })

  it('respects the redirect query param', async () => {
    cognito.handleCallback.mockResolvedValueOnce(session())
    const router = buildRouter('/logga-in?code=abc&redirect=/')
    await router.isReady()
    mount(LoginView, { global: { plugins: [router] } })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('email-OTP: sending a code reveals the code step', async () => {
    const router = buildRouter()
    await router.isReady()
    const w = mount(LoginView, { global: { plugins: [router] } })
    const s = useAdminSessionStore()
    s.requestOtp = vi.fn().mockResolvedValue({ username: 'a@x.se', session: 'sess-1' })

    await w.find('[data-testid="otp-email"]').setValue('A@X.se')
    await w.find('[data-testid="otp-send"]').trigger('submit')
    await flushPromises()

    expect(s.requestOtp).toHaveBeenCalledWith('A@X.se')
    expect(w.find('[data-testid="otp-code"]').exists()).toBe(true)
    expect(w.find('[data-testid="otp-sent"]').exists()).toBe(true)
  })

  it('email-OTP: verifying a code signs in and enters the inbox', async () => {
    const router = buildRouter()
    await router.isReady()
    const w = mount(LoginView, { global: { plugins: [router] } })
    const s = useAdminSessionStore()
    s.requestOtp = vi.fn().mockResolvedValue({ username: 'a@x.se', session: 'sess-1' })
    s.verifyOtp = vi.fn().mockImplementation(async () => {
      Object.assign(s, session())
    })

    await w.find('[data-testid="otp-email"]').setValue('a@x.se')
    await w.find('[data-testid="otp-send"]').trigger('submit')
    await flushPromises()
    await w.find('[data-testid="otp-code"]').setValue('123456')
    await w.find('[data-testid="otp-verify"]').trigger('submit')
    await flushPromises()

    expect(s.verifyOtp).toHaveBeenCalledWith({
      username: 'a@x.se',
      code: '123456',
      session: 'sess-1'
    })
    expect(router.currentRoute.value.name).toBe('inbox')
  })

  it('email-OTP: a wrong code shows an error and keeps the code step', async () => {
    const router = buildRouter()
    await router.isReady()
    const w = mount(LoginView, { global: { plugins: [router] } })
    const s = useAdminSessionStore()
    s.requestOtp = vi.fn().mockResolvedValue({ username: 'a@x.se', session: 'sess-1' })
    s.verifyOtp = vi.fn().mockRejectedValue(new Error('AUTH_OTP_INVALID'))

    await w.find('[data-testid="otp-email"]').setValue('a@x.se')
    await w.find('[data-testid="otp-send"]').trigger('submit')
    await flushPromises()
    await w.find('[data-testid="otp-code"]').setValue('000000')
    await w.find('[data-testid="otp-verify"]').trigger('submit')
    await flushPromises()

    expect(w.find('[data-testid="otp-error"]').exists()).toBe(true)
    expect(w.find('[data-testid="otp-code"]').exists()).toBe(true)
  })
})
