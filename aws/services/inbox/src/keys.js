// Composite-key helpers for the single-table layout. PK = `pk`, SK = `sk`.
// Multi-tenant: org-scoped rows are `${org}:${type}`; global rows use `ALL:`.
// GSI1 keys = `gsi1pk`, `gsi1sk`. Pure string builders — no I/O.

export const tenantKey = (domain) => ({
  pk: 'ALL:tenant',
  sk: String(domain).toLowerCase()
})

export const messageKey = (org, messageId) => ({
  pk: `${org}:message`,
  sk: messageId
})

export const adminKey = (org, email) => ({
  pk: `${org}:admin`,
  sk: String(email).toLowerCase()
})

// Internal notes, one row per note, grouped under a message by SK prefix.
export const noteKey = (org, messageId, createdAt) => ({
  pk: `${org}:note`,
  sk: `${messageId}#${createdAt}`
})

export const notePrefix = (messageId) => `${messageId}#`

// Append-only audit log; SK sorts by time so a descending query is newest-first.
export const auditKey = (org, ts, id) => ({
  pk: `${org}:audit`,
  sk: `${ts}#${id}`
})

export const messageGsi1Pk = (org, box) => `${org}:message:${box}`

export const messageGsi1Sk = (receivedAt, messageId) =>
  `${receivedAt}#${messageId}`

// Fallback tenant slug derived from an email domain when no tenant row exists.
// `newclub.com` -> `newclub-com`. Keeps unknown mail addressable for onboarding.
export const domainSlug = (domain) =>
  String(domain || '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '')
    .replace(/\./g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

// Split an address (bare or `Name <a@b>`) into { local, domain }, lowercased.
export const splitAddress = (raw) => {
  const empty = { local: null, domain: null }
  if (typeof raw !== 'string' || raw.length === 0) return empty
  const angle = raw.match(/<([^>]+)>/)
  const addr = (angle ? angle[1] : raw).trim().toLowerCase()
  const at = addr.lastIndexOf('@')
  if (at <= 0 || at === addr.length - 1) return empty
  return { local: addr.slice(0, at), domain: addr.slice(at + 1) }
}
