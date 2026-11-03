import { httpGet, httpPost, httpDelete } from './api-service'

export const loadTokensAPI = () => httpGet('/admin/tokens')

// The secret is in the create response only; it is never readable again.
export const createTokenAPI = (payload) => httpPost('/admin/tokens', payload)

export const deleteTokenAPI = (tokenId) =>
  httpDelete(`/admin/tokens/${encodeURIComponent(tokenId)}`)
