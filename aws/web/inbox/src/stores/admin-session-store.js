import { defineStore } from 'pinia'
import {
  beginSignIn,
  handleCallback,
  refreshTokens,
  buildSignOutUrl
} from '@/auth/cognito'
import { requestCode, verifyCode } from '@/auth/otp'
import {
  setAdminTokenProvider,
  setAdminOrgProvider,
  setAdminRefreshProvider
} from '@/services/api-service'

const STORAGE_KEY = 'inbox:admin'
const ORG_KEY = 'inbox:org'
// Refresh the id_token a minute before it expires to avoid 401s on long
// admin sessions.
const REFRESH_LEAD_MS = 60_000
// After a transient refresh failure (offline / throttled / 5xx) keep the session
// and retry, doubling the wait up to the cap so an overnight outage doesn't
// hammer the token endpoint.
const REFRESH_RETRY_MS = 30_000
const REFRESH_RETRY_MAX_MS = 300_000
// Pull the refresh forward by a random slice of this window so several open tabs
// don't all hit Cognito in the same second — three at once is enough to look
// like a burst, and a throttled response used to end the session.
const REFRESH_JITTER_MS = 20_000

// Called after a local sign-out (expired refresh token, revoked membership) so
// the app can route away from admin-only views. Wired by the router; the store
// stays router-free to avoid an import cycle.
let onSignedOut = null
export const setSignedOutHandler = (fn) => {
  onSignedOut = fn
}

const parseCaps = (raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export const useAdminSessionStore = defineStore('admin-session-store', {
  state: () => ({
    user: null,
    idToken: null,
    accessToken: null,
    refreshToken: null,
    expiresAt: 0,
    orgs: null,
    currentOrg: null,
    error: null,
    // Why the last refresh failed, kept across signOut so the login screen (and
    // anyone debugging a "logged out too early" report) can see the reason.
    lastRefreshError: null
  }),
  getters: {
    isAuthenticated: (s) =>
      Boolean(s.idToken && s.currentOrg && s.orgs && s.orgs[s.currentOrg]),
    // Logged in but belongs to >1 org and hasn't picked one yet.
    needsOrgSelection: (s) =>
      Boolean(s.idToken && s.orgs && Object.keys(s.orgs).length > 0 && !s.currentOrg),
    // [{ org, name }] for the picker.
    orgOptions: (s) =>
      s.orgs
        ? Object.entries(s.orgs).map(([org, v]) => ({ org, name: v?.name || org }))
        : [],
    organizationId: (s) => s.currentOrg || '',
    capabilities: (s) => {
      const entry = s.currentOrg && s.orgs ? s.orgs[s.currentOrg] : null
      return entry?.capabilities || null
    },
    can: (s) => (path) => {
      const entry = s.currentOrg && s.orgs ? s.orgs[s.currentOrg] : null
      const caps = parseCaps(entry?.capabilities)
      if (!caps) return false
      const [domain, action] = String(path).split('.')
      return Boolean(caps[domain] && caps[domain][action] === true)
    }
  },
  actions: {
    bootstrap() {
      // Wire providers for the http client. Idempotent — store can be
      // re-instantiated freely in tests.
      setAdminTokenProvider(() => this.idToken)
      setAdminOrgProvider(() => this.currentOrg)
      // On a 401 the client asks us to refresh and retry once.
      setAdminRefreshProvider(() => this.refreshAction())
      this._bindCrossTabSync()

      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      try {
        const data = JSON.parse(raw)
        Object.assign(this, data)
        if (!this.orgs || Object.keys(this.orgs).length === 0) {
          this.signOut()
          return
        }
        // Re-resolve the active org (membership may have changed); leaves
        // currentOrg null for multi-org users who must pick again.
        this.currentOrg = this._chooseOrg()
        this.scheduleRefresh()
      } catch {
        localStorage.removeItem(STORAGE_KEY)
      }
    },

    // Tokens live in localStorage, so every tab shares one session. Adopt what
    // another tab just refreshed instead of running our own exchange against
    // Cognito, and follow it out when it signs out. Idempotent: the router guard
    // calls bootstrap() on every guarded navigation while signed out.
    _bindCrossTabSync() {
      if (this._storageBound || typeof window === 'undefined') return
      this._storageBound = true
      window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY) return
        if (e.newValue === null) {
          // Another tab signed out — don't keep serving a session it ended.
          if (this.idToken) this.signOut()
          return
        }
        // Only meaningful for a session we're already in, and only ever tokens:
        // the other tab's org choice is its own.
        if (!this.idToken) return
        let data
        try {
          data = JSON.parse(e.newValue)
        } catch {
          return
        }
        if (!data?.idToken || !(data.expiresAt > this.expiresAt)) return
        this.idToken = data.idToken
        this.accessToken = data.accessToken
        this.refreshToken = data.refreshToken
        this.expiresAt = data.expiresAt
        this.scheduleRefresh()
      })
    },

    // Pick the active org: a still-valid persisted choice, else the sole org,
    // else null (the user must select).
    _chooseOrg() {
      const stored = localStorage.getItem(ORG_KEY)
      if (stored && this.orgs?.[stored]) return stored
      const keys = this.orgs ? Object.keys(this.orgs) : []
      return keys.length === 1 ? keys[0] : null
    },

    selectOrg(org) {
      if (!this.orgs?.[org]) return
      this.currentOrg = org
      localStorage.setItem(ORG_KEY, org)
      this.persist()
    },

    persist() {
      const {
        user,
        idToken,
        accessToken,
        refreshToken,
        expiresAt,
        orgs,
        currentOrg
      } = this
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          user,
          idToken,
          accessToken,
          refreshToken,
          expiresAt,
          orgs,
          currentOrg
        })
      )
    },

    async signInWithGoogle() {
      this.error = null
      // identity_provider: 'Google' forces straight-to-Google.
      await beginSignIn({ identityProvider: 'Google' })
    },

    async completeCallback({ code, state }) {
      this.error = null
      try {
        const session = await handleCallback({ code, state })
        this._applySession(session)
      } catch (e) {
        this.error = e
        throw e
      }
    },

    // Email one-time-code sign-in. requestOtp emails a code and returns the
    // opaque { username, session } the caller passes back to verifyOtp.
    async requestOtp(email) {
      this.error = null
      return requestCode(email)
    },

    async verifyOtp({ username, code, session }) {
      this.error = null
      try {
        this._applySession(await verifyCode({ username, code, session }))
      } catch (e) {
        this.error = e
        throw e
      }
    },

    _applySession(session) {
      Object.assign(this, session)
      this.currentOrg = this._chooseOrg()
      this.persist()
      this.scheduleRefresh()
    },

    scheduleRefresh() {
      if (this._refreshTimer) clearTimeout(this._refreshTimer)
      if (!this.refreshToken || !this.expiresAt) return
      const lead = REFRESH_LEAD_MS + Math.random() * REFRESH_JITTER_MS
      const delay = Math.max(this.expiresAt - Date.now() - lead, 0)
      this._refreshTimer = setTimeout(() => this.refreshAction(), delay)
    },

    // Returns true once a fresh token is in place, false otherwise. Coalesces
    // concurrent callers (the scheduled timer + any 401 retries) onto a single
    // in-flight refresh so a burst of 401s triggers just one token exchange.
    async refreshAction() {
      if (!this.refreshToken) return false
      if (this._refreshInFlight) return this._refreshInFlight
      this._refreshInFlight = (async () => {
        try {
          const next = await refreshTokens(this.refreshToken)
          this.idToken = next.idToken
          this.accessToken = next.accessToken
          this.expiresAt = next.expiresAt
          this._backoffMs = REFRESH_RETRY_MS
          this.persist()
          this.scheduleRefresh()
          return true
        } catch (e) {
          this.error = e
          this.lastRefreshError = {
            status: e?.status ?? 0,
            oauthError: e?.oauthError ?? null,
            definitive: Boolean(e?.definitive),
            at: new Date().toISOString()
          }
          // Otherwise the only trace of an early sign-out is a bare 400 in
          // CloudTrail, which doesn't say whether the token was dead or throttled.
          console.warn('[inbox] token refresh failed', this.lastRefreshError, e?.message)
          if (e?.definitive) {
            // Cognito rejected the refresh token itself (invalid_grant) — the
            // 30-day session is over; force re-login on the next admin action.
            this._backoffMs = REFRESH_RETRY_MS
            this.signOut()
          } else {
            // Transient failure (offline / throttled / 5xx). Keep the still-valid
            // session and retry with backoff so a blip doesn't log the admin out.
            if (this._refreshTimer) clearTimeout(this._refreshTimer)
            const wait = this._backoffMs || REFRESH_RETRY_MS
            this._backoffMs = Math.min(wait * 2, REFRESH_RETRY_MAX_MS)
            this._refreshTimer = setTimeout(() => this.refreshAction(), wait)
          }
          return false
        } finally {
          this._refreshInFlight = null
        }
      })()
      return this._refreshInFlight
    },

    // `federated` redirects to Cognito Hosted UI logout, killing any SSO
    // session at Google too. Default is local-only — the caller routes
    // elsewhere itself (e.g. router.replace).
    signOut({ federated = false } = {}) {
      this.user = null
      this.idToken = null
      this.accessToken = null
      this.refreshToken = null
      this.expiresAt = 0
      this.orgs = null
      this.currentOrg = null
      this._backoffMs = REFRESH_RETRY_MS
      if (this._refreshTimer) clearTimeout(this._refreshTimer)
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(ORG_KEY)
      if (federated && typeof window !== 'undefined') {
        window.location.assign(buildSignOutUrl())
        return
      }
      if (onSignedOut) onSignedOut()
    }
  }
})
