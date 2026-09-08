import { defineStore } from 'pinia'
import { loadAssigneesAPI } from '@/services/inbox-service'

export const useAssigneesStore = defineStore('assignees-store', {
  state: () => ({ list: [], loaded: false }),
  actions: {
    async loadAssigneesAction() {
      try {
        this.list = await loadAssigneesAPI()
        this.loaded = true
      } catch {
        this.list = []
      }
    }
  }
})
