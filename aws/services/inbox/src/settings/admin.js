import { ValidationError } from '../errors.js'
import { recordAudit } from '../audit.js'
import { NOTIFY_DEFAULTS } from '../notify.js'

const GROUP = 'notify'

// What an admin who has made no choice of their own gets. Stored resolved, so
// the API never hands the client a null it has to know how to interpret.
const resolve = (stored) => {
  const out = {}
  for (const [event, fallback] of Object.entries(NOTIFY_DEFAULTS)) {
    out[event] = typeof stored?.[event] === 'boolean' ? stored[event] : fallback
  }
  return out
}

const validate = (defaults) => {
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    throw new ValidationError('NOTIFY_INVALID', 'notifyDefaults must be an object')
  }
  // An empty object asks DynamoDB to SET nothing, which it rejects as a syntax
  // error deep in the update - a 500 for what is a malformed request.
  if (Object.keys(defaults).length === 0) {
    throw new ValidationError('NOTIFY_INVALID', 'notifyDefaults must name at least one notification')
  }
  for (const [event, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(NOTIFY_DEFAULTS, event)) {
      throw new ValidationError('NOTIFY_INVALID', `Unknown notification ${event}`)
    }
    if (typeof value !== 'boolean') {
      throw new ValidationError('NOTIFY_INVALID', `${event} must be a boolean`)
    }
  }
}

export const get = async ({ deps, org }) => ({
  notifyDefaults: resolve(await deps.db.getSettings({ org, group: GROUP }))
})

export const update = async ({ deps, org, body, claims }) => {
  validate(body?.notifyDefaults)
  // Writes only the submitted flags and answers with the row as it now stands,
  // so a concurrent change to the other flag survives and is reported back.
  const saved = await deps.db.updateSettings({
    org,
    group: GROUP,
    settings: body.notifyDefaults
  })
  const notifyDefaults = resolve(saved)
  await recordAudit(deps, {
    org,
    claims,
    action: 'settings.update',
    targetType: 'settings',
    targetId: GROUP,
    targetLabel: GROUP,
    meta: { notifyDefaults }
  })
  return { notifyDefaults }
}
