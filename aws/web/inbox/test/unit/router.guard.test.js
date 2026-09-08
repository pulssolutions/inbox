import { describe, it, expect, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import router from '@/router'
import { useAdminSessionStore } from '@/stores/admin-session-store'

const authedState = (caps = { inbox: { read: true, write: true, send: true } }) => ({
  idToken: 'id',
  refreshToken: 'rt',
  expiresAt: Date.now() + 3600_000,
  currentOrg: 'acme',
  orgs: { acme: { capabilities: caps, active: true } }
})

describe('router admin guard', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    localStorage.clear()
    await router.replace('/logga-in')
    await router.isReady()
  })

  it('redirects unauthenticated users to login', async () => {
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/')
  })

  it('allows an authenticated user with inbox.read', async () => {
    Object.assign(useAdminSessionStore(), authedState())
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('inbox')
  })

  it('blocks a user lacking inbox.read', async () => {
    Object.assign(
      useAdminSessionStore(),
      authedState({ inbox: { read: false, write: false, send: false } })
    )
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('redirects an inbox admin without admins.read away from /admins', async () => {
    Object.assign(useAdminSessionStore(), authedState({ inbox: { read: true } }))
    await router.push('/admins')
    expect(router.currentRoute.value.name).toBe('inbox')
  })

  it('allows a superadmin into /admins', async () => {
    Object.assign(
      useAdminSessionStore(),
      authedState({ inbox: { read: true }, admins: { read: true } })
    )
    await router.push('/admins')
    expect(router.currentRoute.value.name).toBe('admins')
  })

  it('gates /audit on audit.read', async () => {
    Object.assign(useAdminSessionStore(), authedState({ inbox: { read: true } }))
    await router.push('/audit')
    expect(router.currentRoute.value.name).toBe('inbox')
  })

  it('allows a superadmin with audit.read into /audit', async () => {
    Object.assign(
      useAdminSessionStore(),
      authedState({ inbox: { read: true }, audit: { read: true } })
    )
    await router.push('/audit')
    expect(router.currentRoute.value.name).toBe('audit')
  })

  // An expired refresh token signs the session out mid-session; without a
  // redirect the admin is left staring at empty app chrome until they reload.
  it('sends the admin to login when the session is signed out while on an admin route', async () => {
    const session = useAdminSessionStore()
    Object.assign(session, authedState())
    await router.push('/m/m-old')
    expect(router.currentRoute.value.name).toBe('inbox-message')
    session.signOut()
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/m/m-old')
  })
})
