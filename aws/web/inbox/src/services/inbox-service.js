import { httpGet, httpPatch, httpPost, httpDelete } from './api-service'

export const listMessagesAPI = ({ box, category } = {}) =>
  httpGet('/admin/messages', { query: { box, category } })

export const getMessageAPI = (id) =>
  httpGet(`/admin/messages/${encodeURIComponent(id)}`)

export const getRawAPI = (id) =>
  httpGet(`/admin/messages/${encodeURIComponent(id)}/raw`)

// { filename, contentType, size, contentBase64 } — the caller turns it into a
// Blob and saves it. `id` is the thread member the attachment hangs off, not
// necessarily the thread root.
export const getAttachmentAPI = (id, index) =>
  httpGet(
    `/admin/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(index)}`
  )

export const searchMessagesAPI = (q) =>
  httpGet('/admin/messages/search', { query: { q } })

export const loadAssigneesAPI = () => httpGet('/admin/assignees')

// Every category known to the org (message rows + admin scopes), for the
// transfer picker. Not scoped to the caller — moving an issue to a team you are
// not on is the point.
export const loadCategoriesAPI = () => httpGet('/admin/categories')

export const updateMessageAPI = (id, patch) =>
  httpPatch(`/admin/messages/${encodeURIComponent(id)}`, patch)

export const replyAPI = (id, payload) =>
  httpPost(`/admin/messages/${encodeURIComponent(id)}/reply`, payload)

export const transferMessageAPI = (id, category) =>
  httpPost(`/admin/messages/${encodeURIComponent(id)}/transfer`, { category })

export const addNoteAPI = (id, text) =>
  httpPost(`/admin/messages/${encodeURIComponent(id)}/notes`, { text })

export const deleteMessageAPI = async (id) => {
  await httpDelete(`/admin/messages/${encodeURIComponent(id)}`)
  return { id, deleted: true }
}
