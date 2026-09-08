import { httpGet, httpPost, httpPatch, httpDelete } from './api-service'

export const loadAdminsAPI = () => httpGet('/admin/admins')

export const createAdminAPI = (payload) => httpPost('/admin/admins', payload)

export const updateAdminAPI = (email, payload) =>
  httpPatch(`/admin/admins/${encodeURIComponent(email)}`, payload)

export const deleteAdminAPI = async (email) => {
  await httpDelete(`/admin/admins/${encodeURIComponent(email)}`)
  return { email, deleted: true }
}
