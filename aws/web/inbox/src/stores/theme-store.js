import { defineStore } from 'pinia'

const STORAGE_KEY = 'inbox:theme'
const VALID = ['light', 'dark', 'system']

const systemPrefersDark = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

const apply = (effective) => {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.bsTheme = effective
  document.documentElement.dataset.theme = effective
}

export const useThemeStore = defineStore('theme-store', {
  state: () => ({
    mode: 'system',
    systemTheme: 'light'
  }),
  getters: {
    effectiveTheme: (s) => (s.mode === 'system' ? s.systemTheme : s.mode)
  },
  actions: {
    init() {
      const stored = localStorage.getItem(STORAGE_KEY)
      this.mode = VALID.includes(stored) ? stored : 'system'
      this.systemTheme = systemPrefersDark() ? 'dark' : 'light'
      apply(this.effectiveTheme)
      if (typeof window !== 'undefined' && window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)')
        const h = (e) => {
          this.systemTheme = e.matches ? 'dark' : 'light'
          apply(this.effectiveTheme)
        }
        mq.addEventListener?.('change', h)
      }
    },
    setMode(mode) {
      if (!VALID.includes(mode)) return
      this.mode = mode
      localStorage.setItem(STORAGE_KEY, mode)
      apply(this.effectiveTheme)
    },
    toggle() {
      this.setMode(this.effectiveTheme === 'dark' ? 'light' : 'dark')
    }
  }
})
