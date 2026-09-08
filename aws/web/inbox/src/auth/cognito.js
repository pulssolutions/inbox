// Cognito Hosted UI authorization-code flow with PKCE.
// No external SDK — everything below is plain fetch + Web Crypto.

import CONFIG from '@/config'

const STATE_STORAGE_KEY = 'inbox:auth:pkce'

const base64Url = (bytes) => {
  let bin = ''
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const randomString = (n = 64) => {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

const sha256 = async (input) => {
  const encoded = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return base64Url(digest)
}

// Redirect back to the app root (deploy prefix included), not a route path:
// under hash routing the OAuth `?code=` lands in the server query, and only the
// root path is guaranteed to be served by a shared CloudFront origin. The login
// view reads the code from window.location.search on boot.
const callbackUrl = () => `${window.location.origin}${import.meta.env.BASE_URL}`

const persistPkce = (data) => {
  sessionStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(data))
}

const consumePkce = () => {
  const raw = sessionStorage.getItem(STATE_STORAGE_KEY)
  if (!raw) return null
  sessionStorage.removeItem(STATE_STORAGE_KEY)
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const beginSignIn = async ({ identityProvider } = {}) => {
  const codeVerifier = randomString(64)
  const codeChallenge = await sha256(codeVerifier)
  const state = randomString(16)
  persistPkce({ codeVerifier, state })

  const url = new URL(`https://${CONFIG.cognito.domain}/oauth2/authorize`)
  url.searchParams.set('client_id', CONFIG.cognito.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', callbackUrl())
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  if (identityProvider) {
    url.searchParams.set('identity_provider', identityProvider)
  }
  window.location.assign(url.toString())
}

const decodeJwtPayload = (jwt) => {
  const part = jwt.split('.')[1]
  if (!part) return null
  const padded = part.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

export const handleCallback = async ({ code, state }) => {
  const pkce = consumePkce()
  if (!pkce) {
    throw new Error('AUTH_NO_PKCE')
  }
  if (state && pkce.state && state !== pkce.state) {
    throw new Error('AUTH_STATE_MISMATCH')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CONFIG.cognito.clientId,
    code,
    redirect_uri: callbackUrl(),
    code_verifier: pkce.codeVerifier
  })

  const res = await fetch(`https://${CONFIG.cognito.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`AUTH_TOKEN_EXCHANGE: ${res.status} ${text}`)
  }
  const tokens = await res.json()
  return sessionFromTokens(tokens)
}

// Build the store-facing session object from a raw token set (snake_case, as
// returned by the Hosted UI /oauth2/token endpoint). Shared with the email-OTP
// flow so both sign-in paths produce identical session state. Membership is
// whatever the signed claim says — no org = no access.
export const sessionFromTokens = ({
  id_token,
  access_token,
  refresh_token,
  expires_in
}) => {
  const claims = decodeJwtPayload(id_token) || {}
  const orgs = parseOrgs(claims.orgs)
  if (!orgs || Object.keys(orgs).length === 0) {
    throw new Error('AUTH_NO_ORG')
  }
  return {
    idToken: id_token,
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: Date.now() + expires_in * 1000,
    claims,
    orgs,
    user: {
      email: claims.email || '',
      name: claims.name || claims.email || '',
      initials: (claims.email || '?').slice(0, 1).toUpperCase()
    }
  }
}

const parseOrgs = (raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

// A refresh failure that should end the session (Cognito rejected the refresh
// token itself) vs a transient one (network, throttling, 5xx) the caller can
// retry. `definitive` lets the session store decide whether to sign the user
// out; `status`/`oauthError` are kept for diagnostics — without them a throttle
// and a genuinely expired token are indistinguishable after the fact.
export class RefreshError extends Error {
  constructor(message, { definitive, status = 0, oauthError = null }) {
    super(message)
    this.name = 'RefreshError'
    this.definitive = definitive
    this.status = status
    this.oauthError = oauthError
  }
}

export const refreshTokens = async (refreshToken) => {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CONFIG.cognito.clientId,
    refresh_token: refreshToken
  })
  let res
  try {
    res = await fetch(`https://${CONFIG.cognito.domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
  } catch (e) {
    // Network failure (offline, DNS, CORS) — transient, keep the session.
    throw new RefreshError(`AUTH_REFRESH_NETWORK: ${e?.message || e}`, {
      definitive: false
    })
  }
  if (!res.ok) {
    // The body is an RFC 6749 error object: { "error": "invalid_grant", ... }.
    // Only `invalid_grant` means the refresh token is dead and the 30-day
    // session is really over. Everything else — 429 throttling, 5xx, a 400 with
    // any other code, an unparseable body — is survivable, so keep the session
    // and let the caller retry. Treating every 4xx as fatal (as we used to)
    // signed admins out on a single throttled request.
    const payload = await res.json().catch(() => null)
    const oauthError = payload?.error || null
    throw new RefreshError(
      `AUTH_REFRESH_FAILED: ${res.status} ${oauthError || '(no error code)'}`,
      {
        definitive: oauthError === 'invalid_grant',
        status: res.status,
        oauthError
      }
    )
  }
  const tokens = await res.json()
  return {
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000
  }
}

export const buildSignOutUrl = () => {
  const url = new URL(`https://${CONFIG.cognito.domain}/logout`)
  url.searchParams.set('client_id', CONFIG.cognito.clientId)
  url.searchParams.set('logout_uri', `${window.location.origin}${import.meta.env.BASE_URL}`)
  return url.toString()
}
