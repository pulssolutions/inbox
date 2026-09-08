import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  httpGet,
  setAdminTokenProvider,
  setAdminOrgProvider,
  setAdminRefreshProvider
} from '@/services/api-service'

const jsonRes = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  })

describe('api-service X-Org header', () => {
  beforeEach(() => {
    setAdminTokenProvider(() => 'tok')
  })

  it('sends X-Org on admin paths when an org is selected', async () => {
    setAdminOrgProvider(() => 'hundklubben')
    await httpGet('/admin/messages')
    const lastInit = globalThis.fetch.mock.calls.at(-1)[1]
    expect(lastInit.headers['X-Org']).toBe('hundklubben')
    expect(lastInit.headers.Authorization).toBe('Bearer tok')
  })

  it('omits X-Org when no org is selected (single-org users)', async () => {
    setAdminOrgProvider(() => null)
    await httpGet('/admin/messages')
    const lastInit = globalThis.fetch.mock.calls.at(-1)[1]
    expect(lastInit.headers['X-Org']).toBeUndefined()
  })
})

describe('api-service token refresh on 401', () => {
  let original
  beforeEach(() => {
    setAdminOrgProvider(() => null)
    original = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = original
    setAdminRefreshProvider(null)
  })

  it('refreshes and retries once on a 401, then succeeds with the fresh token', async () => {
    let token = 'expired'
    setAdminTokenProvider(() => token)
    const refresh = vi.fn(async () => {
      token = 'fresh'
      return true
    })
    setAdminRefreshProvider(refresh)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(401, { code: 'UNAUTHORIZED' }))
      .mockResolvedValueOnce(jsonRes(200, [{ messageId: 'm1' }]))
    globalThis.fetch = fetchMock

    const res = await httpGet('/admin/messages')
    expect(res).toEqual([{ messageId: 'm1' }])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The retry carries the refreshed token.
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh')
  })

  it('surfaces the 401 without retrying when the refresh fails', async () => {
    setAdminTokenProvider(() => 'expired')
    setAdminRefreshProvider(async () => false)
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(401, { code: 'UNAUTHORIZED' }))
    globalThis.fetch = fetchMock

    await expect(httpGet('/admin/messages')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
