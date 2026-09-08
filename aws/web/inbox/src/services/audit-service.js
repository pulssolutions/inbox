import { httpGet } from './api-service'

export const loadAuditAPI = ({ limit } = {}) =>
  httpGet('/admin/audit', { query: { limit } })
