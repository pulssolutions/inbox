import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { resetTestApi } from '../../setup'
import AdminsView from '@/views/AdminsView.vue'
import { useAdminsStore } from '@/stores/admins-store'
import { useSettingsStore } from '@/stores/settings-store'

const mountView = () => mount(AdminsView)

describe('AdminsView (integration with fetch shim)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetTestApi()
  })

  it('shows a spinner while loading admins (table otherwise)', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.find('.admin-table').exists()).toBe(true)
    // flip loading on → spinner replaces the table
    useAdminsStore().loading.list = true
    await nextTick()
    expect(w.find('[data-testid="spinner"]').exists()).toBe(true)
    expect(w.find('.admin-table').exists()).toBe(false)
  })

  it('lists admins with role + categories', async () => {
    const w = mountView()
    await flushPromises()
    const rows = w.findAll('[data-testid="admin-row"]')
    expect(rows).toHaveLength(2)
    expect(w.text()).toContain('boss@acme.example')
    expect(w.text()).toContain('Superadmin')
    expect(w.text()).toContain('kurser')
  })

  it('creates a scoped admin via the modal', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('[data-testid="add-admin"]').trigger('click')
    await w.find('[data-testid="f-email"]').setValue('ny@acme.example')
    await w.find('[data-testid="f-name"]').setValue('Ny Person')
    await w.find('[data-testid="f-categories"]').setValue('medlem, kurser')
    await w.find('[data-testid="save-admin"]').trigger('click')
    await flushPromises()
    expect(w.findAll('[data-testid="admin-row"]')).toHaveLength(3)
    expect(w.text()).toContain('ny@acme.example')
  })

  it('a new admin inherits both notification defaults until told otherwise', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('[data-testid="add-admin"]').trigger('click')
    expect(w.find('[data-testid="f-notify-newIssue"]').element.value).toBe('inherit')
    expect(w.find('[data-testid="f-notify-reply"]').element.value).toBe('inherit')
    await w.find('[data-testid="f-email"]').setValue('ny@acme.example')
    await w.find('[data-testid="f-name"]').setValue('Ny')
    await w.find('[data-testid="save-admin"]').trigger('click')
    await flushPromises()
    const created = useAdminsStore().admins.find((a) => a.email === 'ny@acme.example')
    expect(created.notifyNewIssue).toBeNull()
    expect(created.notifyReply).toBeNull()
  })

  it('saves each notification choice independently', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('[data-testid="add-admin"]').trigger('click')
    await w.find('[data-testid="f-email"]').setValue('tyst@acme.example')
    await w.find('[data-testid="f-name"]').setValue('Tyst')
    await w.find('[data-testid="f-notify-newIssue"]').setValue('on')
    await w.find('[data-testid="f-notify-reply"]').setValue('off')
    await w.find('[data-testid="save-admin"]').trigger('click')
    await flushPromises()
    const created = useAdminsStore().admins.find((a) => a.email === 'tyst@acme.example')
    expect(created).toMatchObject({ notifyNewIssue: true, notifyReply: false })
  })

  it("labels the inherit option with the org's current default", async () => {
    const w = mountView()
    await flushPromises()
    await w.find('[data-testid="add-admin"]').trigger('click')
    const opts = w.find('[data-testid="f-notify-reply"]').findAll('option')
    expect(opts[0].text()).toContain('Av')
  })

  it('lets a superadmin change the org default', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('[data-testid="default-notify-reply"]').setValue('on')
    await flushPromises()
    expect(useSettingsStore().notifyDefaults.reply).toBe(true)
    // and the per-admin inherit label follows it
    await w.find('[data-testid="add-admin"]').trigger('click')
    expect(w.find('[data-testid="f-notify-reply"]').findAll('option')[0].text()).toContain('På')
  })

  it('hides the category field for superadmins', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('[data-testid="add-admin"]').trigger('click')
    await w.find('[data-testid="f-role"]').setValue('superadmin')
    expect(w.find('[data-testid="f-categories"]').exists()).toBe(false)
  })
})
