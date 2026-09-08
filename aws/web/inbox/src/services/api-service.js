// Typed HTTP client for the inbox backend. Wraps fetch with the
// per-environment base URL and an Authorization header drawn from the admin
// session store on /admin/* paths. Errors come back shaped as
// { name, code, message, status }.

import CONFIG from '@/config'

class ApiError extends Error {
  constructor({ status, code, message }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const isAdminPath = (path) => path.startsWith('/admin/')

let getAdminToken = () => null
let getAdminOrg = () => null
// Refresh the admin token on demand; returns true if a fresh token is now
// available. Wired by the session store; null until then (e.g. in tests).
let refreshAdminToken = null

// The session store wires these at startup so the http client doesn't need to
// import the store directly (avoids circular deps with auth/session bootstrap).
export const setAdminTokenProvider = (fn) => {
  getAdminToken = fn
}
// Selected org → sent as X-Org; the API validates it against the signed claim.
export const setAdminOrgProvider = (fn) => {
  getAdminOrg = fn
}
// On a 401 the client calls this once to refresh the token, then retries. Lets
// a deep-link load recover from an expired (but refreshable) stored token
// instead of showing an empty list until the user reloads.
export const setAdminRefreshProvider = (fn) => {
  refreshAdminToken = fn
}

const buildUrl = (path, query) => {
  const url = new URL(`${CONFIG.apiBase}${path}`)
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue
      url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

const request = async (method, path, opts = {}, retried = false) => {
  const { body, query, signal } = opts
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (isAdminPath(path)) {
    const token = getAdminToken()
    if (!token) {
      throw new ApiError({
        status: 401,
        code: 'NO_TOKEN',
        message: 'Admin session not authenticated'
      })
    }
    headers.Authorization = `Bearer ${token}`
    const org = getAdminOrg()
    if (org) headers['X-Org'] = org
  }

  const res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal
  })

  // A stored admin token can be expired on a fresh load (it outlives the page
  // but not its 1 h TTL). Refresh once and retry so the first call after a
  // deep-link doesn't fail with an empty list.
  if (res.status === 401 && isAdminPath(path) && !retried && refreshAdminToken) {
    const refreshed = await refreshAdminToken()
    if (refreshed) return request(method, path, opts, true)
  }

  if (res.status === 204) return null

  const text = await res.text()
  const data = text ? safeJsonParse(text) : null

  if (!res.ok) {
    throw new ApiError({
      status: res.status,
      code: data?.code || `HTTP_${res.status}`,
      message: data?.message || res.statusText
    })
  }

  return data
}

const safeJsonParse = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const httpGet = (path, opts) => request('GET', path, opts)
export const httpPost = (path, body, opts) =>
  request('POST', path, { ...opts, body })
export const httpPatch = (path, body, opts) =>
  request('PATCH', path, { ...opts, body })
export const httpDelete = (path, opts) => request('DELETE', path, opts)

export { ApiError }
