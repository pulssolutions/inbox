import { defineStore } from 'pinia'
import { loadCategoriesAPI } from '@/services/inbox-service'

// The org's known categories, for the transfer picker. Loaded once per session
// like the assignee list.
export const useCategoriesStore = defineStore('categories-store', {
  state: () => ({ list: [], loaded: false }),
  actions: {
    async loadCategoriesAction() {
      try {
        this.list = await loadCategoriesAPI()
        this.loaded = true
      } catch {
        this.list = []
      }
    }
  }
})
