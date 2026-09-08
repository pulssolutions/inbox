import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useThemeStore } from '@/stores/theme-store'
import { useAdminSessionStore } from '@/stores/admin-session-store'
import './assets/scss/main.scss'

const app = createApp(App)
app.use(createPinia())

// Bootstrap theme + admin session before the router mounts so guards see
// correct auth state and the first paint has the right theme.
useThemeStore().init()
useAdminSessionStore().bootstrap()

app.use(router)
app.mount('#app')
