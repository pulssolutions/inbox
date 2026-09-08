import { defineStore } from 'pinia'
import { loadAuditAPI } from '@/services/audit-service'

export const useAuditStore = defineStore('audit-store', {
  state: () => ({
    entries: [],
    loading: { list: false },
    error: { list: null }
  }),
  actions: {
    async loadAuditAction() {
      this.loading.list = true
      this.error.list = null
      try {
        this.entries = await loadAuditAPI()
      } catch (e) {
        this.error.list = e
        throw e
      } finally {
        this.loading.list = false
      }
    }
  }
})
