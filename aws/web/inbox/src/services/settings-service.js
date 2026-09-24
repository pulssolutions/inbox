import { httpGet, httpPatch, httpPost } from './api-service'

export const loadSettingsAPI = () => httpGet('/admin/settings')

export const updateSettingsAPI = (payload) => httpPatch('/admin/settings', payload)

// Posts the saved template for real and answers with the receiver's status, so
// a template that the receiver rejects is found here rather than by a customer
// mail that quietly went nowhere.
export const testWebhookAPI = () => httpPost('/admin/settings/webhook/test', {})
