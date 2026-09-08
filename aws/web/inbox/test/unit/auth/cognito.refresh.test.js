import { describe, it, expect, beforeEach, vi } from 'vitest'
import { refreshTokens } from '@/auth/cognito'

const errJson = (status, body) => ({
  ok: false,
  status,
  json: async () => body
})

describe('auth/cognito refreshTokens', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('exchanges the refresh token for a fresh id/access token pair', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id_token: 'id-2', access_token: 'acc-2', expires_in: 3600 })
    })
    const out = await refreshTokens('r-1')

    const [url, opts] = fetch.mock.calls[0]
    expect(url).toMatch(/\/oauth2\/token$/)
    expect(opts.body.toString()).toContain('grant_type=refresh_token')
    expect(out.idToken).toBe('id-2')
    expect(out.expiresAt).toBeGreaterThan(Date.now())
  })

  it('invalid_grant is definitive — the refresh token is dead', async () => {
    fetch.mockResolvedValueOnce(errJson(400, { error: 'invalid_grant' }))
    const err = await refreshTokens('r-1').catch((e) => e)
    expect(err.definitive).toBe(true)
    expect(err.oauthError).toBe('invalid_grant')
    expect(err.status).toBe(400)
  })

  it('a throttled refresh (429) is transient — it must not end the session', async () => {
    fetch.mockResolvedValueOnce(errJson(429, { error: 'slow_down' }))
    const err = await refreshTokens('r-1').catch((e) => e)
    expect(err.definitive).toBe(false)
    expect(err.status).toBe(429)
  })

  it('a 400 with any other error code is transient', async () => {
    fetch.mockResolvedValueOnce(errJson(400, { error: 'invalid_request' }))
    const err = await refreshTokens('r-1').catch((e) => e)
    expect(err.definitive).toBe(false)
  })

  it('an unparseable error body is transient, not a sign-out', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => {
        throw new Error('not json')
      }
    })
    const err = await refreshTokens('r-1').catch((e) => e)
    expect(err.definitive).toBe(false)
    expect(err.oauthError).toBeNull()
  })

  it('5xx is transient', async () => {
    fetch.mockResolvedValueOnce(errJson(503, null))
    const err = await refreshTokens('r-1').catch((e) => e)
    expect(err.definitive).toBe(false)
  })

  it('a network failure is transient', async () => {
    fetch.mockRejectedValueOnce(new Error('offline'))
    const err = await refreshTokens('r-1').catch((e) => e)
    expect(err.definitive).toBe(false)
    expect(err.message).toContain('AUTH_REFRESH_NETWORK')
  })
})
