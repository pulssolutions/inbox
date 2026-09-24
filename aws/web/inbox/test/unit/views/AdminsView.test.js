import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { resetTestApi, setWebhookEnabled, setWebhookGroupMissing } from '../../setup'
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

  it('swaps the admin table for the settings panel', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('[data-testid="tab-settings"]').trigger('click')
    expect(w.find('.admin-table').exists()).toBe(false)
    expect(w.find('[data-testid="add-admin"]').exists()).toBe(false)
    // Every setting lives here, and none of it on the Admins tab.
    expect(w.find('[data-testid="default-notify-reply"]').exists()).toBe(true)
    expect(w.find('[data-testid="webhook-url"]').exists()).toBe(true)
    await w.find('[data-testid="tab-admins"]').trigger('click')
    expect(w.find('.admin-table').exists()).toBe(true)
    expect(w.find('[data-testid="default-notify-reply"]').exists()).toBe(false)
    expect(w.find('[data-testid="webhook-url"]').exists()).toBe(false)
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

  it('shows a pre-split admin what they already get, not "follow the default"', async () => {
    const w = mountView()
    await flushPromises()
    // The seeded admins carry neither flag — the shape of a row written before
    // the two were split, when the one flag governed both and absent meant on.
    const rows = w.findAll('[data-testid="admin-row"]')
    const boss = rows.find((r) => r.text().includes('boss@acme.example'))
    await boss.find('button').trigger('click')
    expect(w.find('[data-testid="f-notify-reply"]').element.value).toBe('on')
    // A rename must not quietly move them onto the org default (reply = off).
    await w.find('[data-testid="f-name"]').setValue('Boss Igen')
    await w.find('[data-testid="save-admin"]').trigger('click')
    await flushPromises()
    const saved = useAdminsStore().admins.find((a) => a.email === 'boss@acme.example')
    expect(saved).toMatchObject({ name: 'Boss Igen', notifyNewIssue: true, notifyReply: true })
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
    await w.find('[data-testid="tab-settings"]').trigger('click')
    await w.find('[data-testid="default-notify-reply"]').setValue('on')
    await flushPromises()
    expect(useSettingsStore().notifyDefaults.reply).toBe(true)
    // and the per-admin inherit label follows it
    await w.find('[data-testid="tab-admins"]').trigger('click')
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

  describe('webhook', () => {
    const openSettings = async () => {
      const w = mountView()
      await flushPromises()
      await w.find('[data-testid="tab-settings"]').trigger('click')
      return w
    }

    it('saves what was typed, and only on the button', async () => {
      const w = await openSettings()
      await w.find('[data-testid="webhook-url"]').setValue('https://3.basecamp.com/1/i/t/lines')
      await w.find('[data-testid="webhook-template"]').setValue('<b>{{subject}}</b>')
      // Typing alone must not write a half-finished template.
      expect(useSettingsStore().webhook.url).toBe('')
      await w.find('[data-testid="webhook-save"]').trigger('click')
      await flushPromises()
      expect(useSettingsStore().webhook).toMatchObject({
        url: 'https://3.basecamp.com/1/i/t/lines',
        template: '<b>{{subject}}</b>'
      })
    })

    it('reports what the server said when it refuses the template', async () => {
      const w = await openSettings()
      await w.find('[data-testid="webhook-template"]').setValue('{{nope}}')
      await w.find('[data-testid="webhook-save"]').trigger('click')
      await flushPromises()
      expect(w.find('[data-testid="webhook-error"]').text()).toContain('Unknown placeholder nope')
    })

    it('tests only once a url is saved, and shows the outcome', async () => {
      const w = await openSettings()
      expect(w.find('[data-testid="webhook-test"]').attributes('disabled')).toBeDefined()
      await w.find('[data-testid="webhook-url"]').setValue('https://3.basecamp.com/1/i/t/lines')
      await w.find('[data-testid="webhook-save"]').trigger('click')
      await flushPromises()
      await w.find('[data-testid="webhook-test"]').trigger('click')
      await flushPromises()
      expect(w.find('[data-testid="webhook-test-result"]').text()).toContain('levererades')
    })

    it('survives an API that has never heard of the webhook group', async () => {
      // A partial deploy: the web stack shipped, the service stack did not, so
      // GET /admin/settings answers without `webhook` at all. Assigning that
      // over the store's defaults used to blank them and take the page down.
      setWebhookGroupMissing(true)
      const w = await openSettings()
      expect(w.find('[data-testid="webhook-off"]').exists()).toBe(true)
      expect(useSettingsStore().webhook.enabled).toBe(false)
      // The settings the old API does know about still work.
      expect(w.find('[data-testid="default-notify-reply"]').exists()).toBe(true)
    })

    it('says so instead of offering a form when the deployment has webhooks off', async () => {
      setWebhookEnabled(false)
      const w = await openSettings()
      expect(w.find('[data-testid="webhook-off"]').exists()).toBe(true)
      expect(w.find('[data-testid="webhook-url"]').exists()).toBe(false)
      // The notification defaults are unaffected - they are not the webhook.
      expect(w.find('[data-testid="default-notify-reply"]').exists()).toBe(true)
    })
  })
})
