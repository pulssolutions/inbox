import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { resetTestApi } from '../../setup'
import AuditView from '@/views/AuditView.vue'
import { useAuditStore } from '@/stores/audit-store'

describe('AuditView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetTestApi()
  })

  it('lists audit entries newest-first with actor + action + target', async () => {
    const w = mount(AuditView)
    await flushPromises()
    const rows = w.findAll('[data-testid="audit-row"]')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('Boss')
    expect(rows[0].text()).toContain('Status') // newest = state change
    expect(rows[1].text()).toContain('Tog bort') // delete
    expect(rows[2].text()).toContain('Svar') // reply
  })

  it('expands details on click (status from→to), table otherwise neat', async () => {
    const w = mount(AuditView)
    await flushPromises()
    // first row = state change (a3)
    expect(w.find('[data-testid="audit-details"]').exists()).toBe(false)
    await w.findAll('[data-testid="audit-details-toggle"]')[0].trigger('click')
    expect(w.find('[data-testid="audit-details"]').text()).toContain('Status: Öppen → Klar')
  })

  it('shows a spinner while loading', async () => {
    const w = mount(AuditView)
    await flushPromises()
    useAuditStore().loading.list = true
    await nextTick()
    expect(w.find('[data-testid="spinner"]').exists()).toBe(true)
    expect(w.find('.admin-table').exists()).toBe(false)
  })
})
