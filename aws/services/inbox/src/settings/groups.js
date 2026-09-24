import { ValidationError } from '../errors.js'
import { NOTIFY_DEFAULTS } from '../notify.js'
import { validateWebhookUrl, unknownPlaceholders } from '../webhook.js'

// One entry per settings group, each holding its own defaults and its own
// validation. The alternative - a growing if-chain in the handler - decides
// what a group means in two places at once, and the second group is where that
// starts to drift.

// Mirrors the Zendesk line the Basecamp support campfire already receives: a
// link back to the thread, who wrote, and the mail quoted underneath.
const DEFAULT_TEMPLATE = [
  '<table><tbody>',
  '<tr><td><a href="{{url}}">{{category}}</a></td><td>{{subject}}</td></tr>',
  '<tr><td><b>Från:</b></td><td>{{from}}</td></tr>',
  '<tr><td colspan="2"><blockquote>{{body}}</blockquote></td></tr>',
  '</tbody></table>'
].join('\n')

// Basecamp Campfire and Discord; Slack and Teams want {"text":"{{content}}"}.
const DEFAULT_ENVELOPE = '{"content":"{{content}}"}'

export const WEBHOOK_DEFAULTS = {
  url: '',
  template: DEFAULT_TEMPLATE,
  envelope: DEFAULT_ENVELOPE,
  token: '',
  onNewIssue: true,
  onReply: true
}

const asObject = (value, code, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(code, `${label} must be an object`)
  }
  // An empty object asks DynamoDB to SET nothing, which it rejects as a syntax
  // error deep in the update - a 500 for what is a malformed request.
  if (Object.keys(value).length === 0) {
    throw new ValidationError(code, `${label} must name at least one field`)
  }
}

const validateNotify = (defaults) => {
  asObject(defaults, 'NOTIFY_INVALID', 'notifyDefaults')
  for (const [event, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(NOTIFY_DEFAULTS, event)) {
      throw new ValidationError('NOTIFY_INVALID', `Unknown notification ${event}`)
    }
    if (typeof value !== 'boolean') {
      throw new ValidationError('NOTIFY_INVALID', `${event} must be a boolean`)
    }
  }
}

const validateWebhook = (webhook) => {
  asObject(webhook, 'WEBHOOK_INVALID', 'webhook')
  for (const [field, value] of Object.entries(webhook)) {
    if (!Object.hasOwn(WEBHOOK_DEFAULTS, field)) {
      throw new ValidationError('WEBHOOK_INVALID', `Unknown setting ${field}`)
    }
    if (typeof value !== typeof WEBHOOK_DEFAULTS[field]) {
      throw new ValidationError('WEBHOOK_INVALID', `${field} must be a ${typeof WEBHOOK_DEFAULTS[field]}`)
    }
  }
  // An empty url is how the webhook is turned off, so it is not a bad one.
  if (webhook.url) validateWebhookUrl(webhook.url)
  if (webhook.template !== undefined) {
    const unknown = unknownPlaceholders(webhook.template)
    if (unknown.length) {
      throw new ValidationError('WEBHOOK_INVALID', `Unknown placeholder ${unknown.join(', ')}`)
    }
  }
  if (webhook.envelope !== undefined && !webhook.envelope.includes('{{content}}')) {
    throw new ValidationError('WEBHOOK_INVALID', 'envelope must contain {{content}}')
  }
}

export const GROUPS = {
  notify: { key: 'notifyDefaults', defaults: NOTIFY_DEFAULTS, validate: validateNotify },
  webhook: { key: 'webhook', defaults: WEBHOOK_DEFAULTS, validate: validateWebhook }
}

// Stored values filled out from the code defaults, so the API never hands the
// client a null it has to know how to interpret, and an attribute left over
// from an older shape is never echoed back.
export const resolve = (group, stored) => {
  const out = {}
  for (const [field, fallback] of Object.entries(GROUPS[group].defaults)) {
    out[field] = typeof stored?.[field] === typeof fallback ? stored[field] : fallback
  }
  return out
}
