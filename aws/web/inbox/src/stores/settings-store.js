import { defineStore } from 'pinia'
import { loadSettingsAPI, updateSettingsAPI, testWebhookAPI } from '@/services/settings-service'

// Org-wide settings: notification defaults for admins who have made no choice
// of their own, and the webhook that pushes new messages onwards. The API
// always answers with every group resolved, so there is no null to handle here.
export const useSettingsStore = defineStore('settings-store', {
  state: () => ({
    notifyDefaults: { newIssue: true, reply: false },
    webhook: {
      // `enabled` is the deployment's answer, not the org's: false means
      // nothing reads the stream, so nothing would act on what is saved here.
      enabled: false,
      url: '',
      template: '',
      envelope: '',
      token: '',
      onNewIssue: true,
      onReply: true
    },
    loading: { load: false, save: false, webhook: false, test: false },
    error: { load: null, save: null, webhook: null },
    testResult: null
  }),
  actions: {
    async loadSettingsAction() {
      this.loading.load = true
      this.error.load = null
      try {
        // Merged into the defaults rather than assigned over them. A server
        // that does not know a settings group - an older API during a partial
        // deploy, where the web stack shipped and the service stack did not -
        // simply omits it, and a page must not break because of that.
        const { notifyDefaults, webhook } = await loadSettingsAPI()
        this.notifyDefaults = { ...this.notifyDefaults, ...notifyDefaults }
        this.webhook = { ...this.webhook, ...webhook }
      } catch (e) {
        this.error.load = e
        throw e
      } finally {
        this.loading.load = false
      }
    },

    async updateNotifyDefaultsAction(patch) {
      this.loading.save = true
      this.error.save = null
      try {
        const { notifyDefaults } = await updateSettingsAPI({ notifyDefaults: patch })
        this.notifyDefaults = { ...this.notifyDefaults, ...notifyDefaults }
      } catch (e) {
        this.error.save = e
        throw e
      } finally {
        this.loading.save = false
      }
    },

    // Saved on an explicit button, unlike the notify selects: a half-typed
    // template should not be written on every keystroke.
    async updateWebhookAction(patch) {
      this.loading.webhook = true
      this.error.webhook = null
      this.testResult = null
      try {
        const { webhook } = await updateSettingsAPI({ webhook: patch })
        this.webhook = { ...this.webhook, ...webhook }
      } catch (e) {
        this.error.webhook = e
        throw e
      } finally {
        this.loading.webhook = false
      }
    },

    async testWebhookAction() {
      this.loading.test = true
      this.testResult = null
      try {
        this.testResult = await testWebhookAPI()
      } catch (e) {
        // A refused test is the answer, not a crash - reporting it is the whole
        // point of the button.
        this.testResult = { delivered: false, error: e?.message || 'Kunde inte testa' }
      } finally {
        this.loading.test = false
      }
      return this.testResult
    }
  }
})
