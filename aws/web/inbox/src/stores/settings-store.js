import { defineStore } from 'pinia'
import { loadSettingsAPI, updateSettingsAPI } from '@/services/settings-service'

// Org-wide defaults for admins who have made no choice of their own. The API
// always answers with both events resolved, so there is no null to handle here.
export const useSettingsStore = defineStore('settings-store', {
  state: () => ({
    notifyDefaults: { newIssue: true, reply: false },
    loading: { load: false, save: false },
    error: { load: null, save: null }
  }),
  actions: {
    async loadSettingsAction() {
      this.loading.load = true
      this.error.load = null
      try {
        const { notifyDefaults } = await loadSettingsAPI()
        this.notifyDefaults = notifyDefaults
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
        this.notifyDefaults = notifyDefaults
      } catch (e) {
        this.error.save = e
        throw e
      } finally {
        this.loading.save = false
      }
    }
  }
})
