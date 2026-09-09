import { PermissionError, NotFoundError } from './errors.js'

const parseOrgs = (raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

const readOrgEntry = (claims, org) => {
  const orgs = parseOrgs(claims?.orgs)
  if (!orgs) return null
  const entry = orgs[org]
  if (!entry || typeof entry !== 'object') return null
  if (entry.active === false) return null
  return entry
}

export const requireAdmin = (event, org) => {
  const claims = event?.requestContext?.authorizer?.jwt?.claims
  if (!claims) {
    throw new PermissionError('NO_AUTH', 'Admin authentication required')
  }
  if (!org) {
    throw new PermissionError('NO_ORG', 'Org required to check admin claim')
  }
  const entry = readOrgEntry(claims, org)
  if (!entry) {
    throw new PermissionError('NO_ORG', `Token missing access for org ${org}`)
  }
  return claims
}

// Allowed categories for the caller IN A GIVEN ORG, from the signed `orgs`
// claim (orgs[org].categories): '*' (all) or an array of category slugs.
// Authoritative — the client cannot forge it.
export const allowedCategories = (claims, org) => {
  const orgs = parseOrgs(claims?.orgs)
  const raw = orgs && org ? orgs[org]?.categories : undefined
  // Absent means unscoped: the pretoken trigger omits the key for an admin
  // with no category restriction rather than writing '*'.
  if (raw === undefined || raw === null || raw === '*') return '*'
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Not JSON. Falls through to the deny below.
    }
  }
  // Fail CLOSED. This feeds assertCategoryAllowed, the guard every message- and
  // note-touching handler runs, so a value we cannot read must never widen
  // access - the symptom would be a scoped admin quietly seeing every category.
  // Nothing emits this today; it can only come from a pretoken regression or a
  // change of claim shape, so say so rather than failing mutely.
  // eslint-disable-next-line no-console
  console.warn('unreadable categories claim for org', org, '- denying all categories')
  return []
}

// Hard server-side category guard. Throws NotFoundError (404, not 403 — don't
// reveal existence) when the caller may not access the given category in this
// org. Call this in EVERY message-/note-touching handler before any read/write.
export const assertCategoryAllowed = (claims, org, category) => {
  const allowed = allowedCategories(claims, org)
  if (allowed === '*') return
  if (!allowed.includes(category)) {
    throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
  }
}

// Display name of an org from the signed claim (orgs[org].name), falling back
// to the org slug. Used as the heading for themed outgoing mail.
export const orgName = (claims, org) => {
  const orgs = parseOrgs(claims?.orgs)
  return (orgs && org && orgs[org]?.name) || org || ''
}

export const requireCapability = (event, org, path) => {
  const claims = requireAdmin(event, org)
  const entry = readOrgEntry(claims, org)
  const caps = entry?.capabilities
  if (!caps || typeof caps !== 'object') {
    throw new PermissionError('NO_CAP', 'Token missing capabilities for org')
  }
  const [domain, action] = String(path).split('.')
  if (!domain || !action || !caps[domain] || caps[domain][action] !== true) {
    throw new PermissionError('NO_CAP', `Missing capability ${path}`)
  }
  return claims
}
