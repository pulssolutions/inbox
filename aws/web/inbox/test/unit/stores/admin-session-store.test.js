import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/auth/cognito', () => ({
  beginSignIn: vi.fn(),
  handleCallback: vi.fn(),
  refreshTokens: vi.fn(),
  buildSignOutUrl: () => 'https://x/logout'
}))

vi.mock('@/auth/otp', () => ({
  requestCode: vi.fn(),
  verifyCode: vi.fn()
}))

import { useAdminSessionStore } from '@/stores/admin-session-store'
import * as cognito from '@/auth/cognito'
import * as otp from '@/auth/otp'

const orgs2 = {
  acme: { capabilities: { inbox: { read: true } }, name: 'RBK' },
  hundklubben: { capabilities: { inbox: { read: true } }, name: 'Hundklubben' }
}

describe('admin-session-store multi-org selection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('single org → auto-selected on callback', async () => {
    cognito.handleCallback.mockResolvedValueOnce({
      idToken: 'id',
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
      orgs: { acme: { capabilities: { inbox: { read: true } }, name: 'RBK' } },
      user: { email: 'a@x' }
    })
    const s = useAdminSessionStore()
    await s.completeCallback({ code: 'c' })
    expect(s.currentOrg).toBe('acme')
    expect(s.isAuthenticated).toBe(true)
    expect(s.needsOrgSelection).toBe(false)
  })

  it('multiple orgs → needs selection, no currentOrg', async () => {
    cognito.handleCallback.mockResolvedValueOnce({
      idToken: 'id',
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
      orgs: orgs2,
      user: { email: 'a@x' }
    })
    const s = useAdminSessionStore()
    await s.completeCallback({ code: 'c' })
    expect(s.currentOrg).toBeNull()
    expect(s.needsOrgSelection).toBe(true)
    expect(s.orgOptions.map((o) => o.org).sort()).toEqual(['acme', 'hundklubben'])
  })

  it('selectOrg sets + persists the choice', async () => {
    const s = useAdminSessionStore()
    s.idToken = 'id'
    s.orgs = orgs2
    s.selectOrg('hundklubben')
    expect(s.currentOrg).toBe('hundklubben')
    expect(localStorage.getItem('inbox:org')).toBe('hundklubben')
    expect(s.can('inbox.read')).toBe(true)
  })

  it('ignores selecting an org the user is not a member of', () => {
    const s = useAdminSessionStore()
    s.idToken = 'id'
    s.orgs = orgs2
    s.selectOrg('evil')
    expect(s.currentOrg).toBeNull()
  })

  it('requestOtp delegates to the otp service', async () => {
    otp.requestCode.mockResolvedValueOnce({ username: 'a@x', session: 'sess-1' })
    const s = useAdminSessionStore()
    const out = await s.requestOtp('A@X')
    expect(otp.requestCode).toHaveBeenCalledWith('A@X')
    expect(out).toEqual({ username: 'a@x', session: 'sess-1' })
  })

  it('verifyOtp applies the session like the Google callback', async () => {
    otp.verifyCode.mockResolvedValueOnce({
      idToken: 'id',
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
      orgs: { acme: { capabilities: { inbox: { read: true } }, name: 'RBK' } },
      user: { email: 'a@x' }
    })
    const s = useAdminSessionStore()
    await s.verifyOtp({ username: 'a@x', code: '123', session: 'sess-1' })
    expect(s.currentOrg).toBe('acme')
    expect(s.isAuthenticated).toBe(true)
  })

  it('a persisted org choice is restored when still a member', async () => {
    localStorage.setItem('inbox:org', 'hundklubben')
    cognito.handleCallback.mockResolvedValueOnce({
      idToken: 'id',
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
      orgs: orgs2,
      user: { email: 'a@x' }
    })
    const s = useAdminSessionStore()
    await s.completeCallback({ code: 'c' })
    expect(s.currentOrg).toBe('hundklubben')
  })
})

describe('admin-session-store token refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Each test leaves a scheduled refresh behind on its own store; without this
    // they fire into the next test's shared refreshTokens mock.
    vi.clearAllTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  const loggedIn = () => {
    const s = useAdminSessionStore()
    s.idToken = 'old-id'
    s.accessToken = 'old-access'
    s.refreshToken = 'r-1'
    s.expiresAt = Date.now() + 3600_000
    s.orgs = { acme: { capabilities: { inbox: { read: true } }, name: 'RBK' } }
    s.currentOrg = 'acme'
    return s
  }

  it('success swaps in the new tokens', async () => {
    cognito.refreshTokens.mockResolvedValueOnce({
      idToken: 'new-id',
      accessToken: 'new-access',
      expiresAt: Date.now() + 3600_000
    })
    const s = loggedIn()
    await s.refreshAction()
    expect(s.idToken).toBe('new-id')
    expect(s.accessToken).toBe('new-access')
    expect(s.isAuthenticated).toBe(true)
  })

  it('a definitive failure (rejected refresh token) signs the admin out', async () => {
    cognito.refreshTokens.mockRejectedValueOnce(
      Object.assign(new Error('AUTH_REFRESH_FAILED: 400'), { definitive: true })
    )
    const s = loggedIn()
    await s.refreshAction()
    expect(s.idToken).toBeNull()
    expect(s.refreshToken).toBeNull()
    expect(s.isAuthenticated).toBe(false)
  })

  it('a transient failure keeps the session and retries', async () => {
    cognito.refreshTokens
      .mockRejectedValueOnce(
        Object.assign(new Error('AUTH_REFRESH_NETWORK'), { definitive: false })
      )
      .mockResolvedValueOnce({
        idToken: 'new-id',
        accessToken: 'new-access',
        expiresAt: Date.now() + 3600_000
      })
    const s = loggedIn()
    await s.refreshAction()
    // Session intact after the transient failure — not signed out.
    expect(s.idToken).toBe('old-id')
    expect(s.refreshToken).toBe('r-1')
    // The scheduled retry fires and succeeds.
    await vi.runOnlyPendingTimersAsync()
    expect(s.idToken).toBe('new-id')
  })

  it('repeated transient failures back off instead of retrying every 30s', async () => {
    const transient = () =>
      Object.assign(new Error('AUTH_REFRESH_FAILED: 429'), {
        definitive: false,
        status: 429
      })
    cognito.refreshTokens
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce({
        idToken: 'new-id',
        accessToken: 'new-access',
        expiresAt: Date.now() + 3600_000
      })
    const s = loggedIn()
    await s.refreshAction()
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(1)

    // First retry at 30 s.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(2)

    // Second waits twice as long — still quiet at 30 s, fires at 60 s.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(3)
    expect(s.idToken).toBe('new-id')
    expect(s.isAuthenticated).toBe(true)
  })

  it('records why the refresh failed', async () => {
    cognito.refreshTokens.mockRejectedValueOnce(
      Object.assign(new Error('AUTH_REFRESH_FAILED: 400 invalid_grant'), {
        definitive: true,
        status: 400,
        oauthError: 'invalid_grant'
      })
    )
    const s = loggedIn()
    await s.refreshAction()
    expect(s.lastRefreshError).toMatchObject({
      status: 400,
      oauthError: 'invalid_grant',
      definitive: true
    })
    // Survives the sign-out so the login screen can explain itself.
    expect(s.isAuthenticated).toBe(false)
  })
})

describe('admin-session-store cross-tab sync', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  const signedIn = () => {
    const s = useAdminSessionStore()
    s.bootstrap()
    s.idToken = 'old-id'
    s.accessToken = 'old-access'
    s.refreshToken = 'r-1'
    s.expiresAt = 1000
    s.orgs = { acme: { capabilities: { inbox: { read: true } }, name: 'RBK' } }
    s.currentOrg = 'acme'
    return s
  }

  const fireStorage = (newValue) =>
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'inbox:admin', newValue })
    )

  it('adopts tokens another tab refreshed instead of exchanging its own', () => {
    const s = signedIn()
    fireStorage(
      JSON.stringify({ idToken: 'newer-id', accessToken: 'newer-access', refreshToken: 'r-1', expiresAt: 5000 })
    )
    expect(s.idToken).toBe('newer-id')
    expect(s.accessToken).toBe('newer-access')
    expect(s.expiresAt).toBe(5000)
  })

  it('ignores an older token set', () => {
    const s = signedIn()
    fireStorage(JSON.stringify({ idToken: 'stale-id', expiresAt: 500 }))
    expect(s.idToken).toBe('old-id')
  })

  it('never takes another tab’s org choice', () => {
    const s = signedIn()
    s.orgs = orgs2
    s.currentOrg = 'acme'
    fireStorage(
      JSON.stringify({ idToken: 'newer-id', expiresAt: 5000, currentOrg: 'hundklubben' })
    )
    expect(s.currentOrg).toBe('acme')
  })

  it('follows another tab out when it signs out', () => {
    const s = signedIn()
    fireStorage(null)
    expect(s.idToken).toBeNull()
    expect(s.isAuthenticated).toBe(false)
  })

  it('binds the listener once even though the router guard re-bootstraps', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const s = useAdminSessionStore()
    s.bootstrap()
    s.bootstrap()
    s.bootstrap()
    expect(add.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1)
    add.mockRestore()
  })
})
