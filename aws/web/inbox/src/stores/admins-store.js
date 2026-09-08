import { defineStore } from 'pinia'
import {
  loadAdminsAPI,
  createAdminAPI,
  updateAdminAPI,
  deleteAdminAPI
} from '@/services/admins-service'

export const useAdminsStore = defineStore('admins-store', {
  state: () => ({
    admins: [],
    loading: { list: false, save: false },
    error: { list: null, save: null }
  }),
  actions: {
    async loadAdminsAction() {
      this.loading.list = true
      this.error.list = null
      try {
        this.admins = await loadAdminsAPI()
      } catch (e) {
        this.error.list = e
        throw e
      } finally {
        this.loading.list = false
      }
    },

    async createAdminAction(payload) {
      this.loading.save = true
      this.error.save = null
      try {
        const created = await createAdminAPI(payload)
        this.admins = [...this.admins, created]
        return created
      } catch (e) {
        this.error.save = e
        throw e
      } finally {
        this.loading.save = false
      }
    },

    async updateAdminAction(email, payload) {
      this.loading.save = true
      this.error.save = null
      try {
        const updated = await updateAdminAPI(email, payload)
        this.admins = this.admins.map((a) => (a.email === email ? updated : a))
        return updated
      } catch (e) {
        this.error.save = e
        throw e
      } finally {
        this.loading.save = false
      }
    },

    async deleteAdminAction(email) {
      await deleteAdminAPI(email)
      this.admins = this.admins.filter((a) => a.email !== email)
    }
  }
})
