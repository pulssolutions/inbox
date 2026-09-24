import { ValidationError } from '../errors.js'
import { recordAudit } from '../audit.js'
import { GROUPS, resolve } from './groups.js'
import { deliver, SAMPLE_MESSAGE } from '../webhook/deliver.js'

// The client names a group by its payload key (`notifyDefaults`, `webhook`),
// which is what the form has in hand; storage names it by group.
const byKey = Object.fromEntries(
  Object.entries(GROUPS).map(([group, spec]) => [spec.key, group])
)

const read = async (deps, org, group) =>
  resolve(group, await deps.db.getSettings({ org, group }))

// The audit log is readable by every superadmin and kept forever. A shared
// secret belongs in neither.
const redact = (key, settings) =>
  key === 'webhook' ? { ...settings, token: settings.token ? '***' : '' } : settings

export const get = async ({ deps, org }) => {
  const out = {}
  for (const [group, spec] of Object.entries(GROUPS)) {
    out[spec.key] = await read(deps, org, group)
  }
  // Whether this deployment reads the stream at all. Without it the UI would
  // offer a form that saves a row nothing will ever act on.
  out.webhook.enabled = deps.webhookEnabled === true
  return out
}

export const update = async ({ deps, org, body, claims }) => {
  const submitted = Object.keys(body || {}).filter((key) => byKey[key])
  if (!submitted.length) {
    throw new ValidationError('SETTINGS_EMPTY', `Provide ${Object.keys(byKey).join(' or ')}`)
  }

  const out = {}
  for (const key of submitted) {
    const group = byKey[key]
    // `enabled` is the deployment's answer, not the org's, so it is never stored.
    const { enabled, ...settings } = body[key]
    GROUPS[group].validate(settings)
    // Writes only the submitted fields and answers with the row as it now
    // stands, so a concurrent change to another field survives and is reported
    // back.
    const saved = await deps.db.updateSettings({ org, group, settings })
    out[key] = resolve(group, saved)
    await recordAudit(deps, {
      org,
      claims,
      action: 'settings.update',
      targetType: 'settings',
      targetId: group,
      targetLabel: group,
      meta: { [key]: redact(key, out[key]) }
    })
  }

  // Answer with every group, not only the one that changed, so the client's
  // state cannot drift from the server's.
  for (const [group, spec] of Object.entries(GROUPS)) {
    if (!out[spec.key]) out[spec.key] = await read(deps, org, group)
  }
  out.webhook.enabled = deps.webhookEnabled === true
  return out
}

// Posts the saved template against a sample message, so an admin finds out here
// whether the receiver accepts it - rather than from a customer mail that
// quietly went nowhere.
export const test = async ({ deps, org }) => {
  const webhook = await read(deps, org, 'webhook')
  if (!webhook.url) {
    throw new ValidationError('WEBHOOK_NO_URL', 'Configure a URL first')
  }
  const result = await deliver({
    deps,
    org,
    message: { ...SAMPLE_MESSAGE, orgName: org },
    webhook
  })
  return { delivered: result.delivered, status: result.status ?? null, error: result.error ?? null }
}
