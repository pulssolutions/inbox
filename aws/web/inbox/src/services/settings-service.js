import { httpGet, httpPatch } from './api-service'

export const loadSettingsAPI = () => httpGet('/admin/settings')

export const updateSettingsAPI = (payload) => httpPatch('/admin/settings', payload)
