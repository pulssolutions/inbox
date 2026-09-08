import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { resetTestApi } from '../../setup'
import AdminsView from '@/views/AdminsView.vue'
import { useAdminsStore } from '@/stores/admins-store'

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

  it('new-issue-email checkbox defaults checked and persists when unchecked', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('[data-testid="add-admin"]').trigger('click')
    const cb = w.find('[data-testid="f-notify"]')
    expect(cb.exists()).toBe(true)
    expect(cb.element.checked).toBe(true) // default true
    await w.find('[data-testid="f-email"]').setValue('tyst@acme.example')
    await w.find('[data-testid="f-name"]').setValue('Tyst')
    await cb.setValue(false)
    await w.find('[data-testid="save-admin"]').trigger('click')
    await flushPromises()
    const created = useAdminsStore().admins.find((a) => a.email === 'tyst@acme.example')
    expect(created.notifyNewIssue).toBe(false)
  })

  it('hides the category field for superadmins', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('[data-testid="add-admin"]').trigger('click')
    await w.find('[data-testid="f-role"]').setValue('superadmin')
    expect(w.find('[data-testid="f-categories"]').exists()).toBe(false)
  })
})
