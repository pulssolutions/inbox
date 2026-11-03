import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { resetTestApi } from '../../setup'
import AdminsView from '@/views/AdminsView.vue'
import { useAdminSessionStore } from '@/stores/admin-session-store'

const grant = (caps) => {
  const session = useAdminSessionStore()
  session.orgs = { acme: { capabilities: { inbox: { read: true }, ...caps }, active: true } }
  session.currentOrg = 'acme'
  session.idToken = 'x'
}

const openSettings = async () => {
  const w = mount(AdminsView)
  await flushPromises()
  await w.find('[data-testid="tab-settings"]').trigger('click')
  await flushPromises()
  return w
}

describe('AdminsView API tokens', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetTestApi()
  })

  it('is hidden without admins.write', async () => {
    grant({ admins: { read: true } })
    const w = await openSettings()
    expect(w.find('[data-testid="tokens"]').exists()).toBe(false)
  })

  it('creates a token, shows the secret once, and deletes it', async () => {
    grant({ admins: { read: true, write: true } })
    window.confirm = () => true
    const w = await openSettings()
    expect(w.findAll('[data-testid="token-row"]')).toHaveLength(0)
    await w.find('[data-testid="token-name"]').setValue('bot')
    await w.find('[data-testid="token-owner"]').setValue('leader@acme.example')
    await w.find('[data-testid="token-create"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="token-secret"]').text()).toMatch(/^inbx_/)
    expect(w.findAll('[data-testid="token-row"]')).toHaveLength(1)
    expect(w.find('[data-testid="token-row"]').text()).toContain('leader@acme.example')
    await w.find('[data-testid="token-delete"]').trigger('click')
    await flushPromises()
    expect(w.findAll('[data-testid="token-row"]')).toHaveLength(0)
    expect(w.find('[data-testid="token-secret"]').exists()).toBe(false)
  })
})
