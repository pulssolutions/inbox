// Multi-tenant org resolution for the API.
//
// Authorization lives in the signed `orgs` claim (set by the pretoken from DB
// membership). A request picks WHICH member org it acts on via the `X-Org`
// header — but the header only selects; it can never grant access:
//   - header present and in the claim's orgs  -> use it
//   - header absent and the user has exactly one org -> use that
//   - otherwise -> null (the auth layer then rejects)
// requireCapability() re-checks orgs[org], so a forged header is inert.

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

const headerOrg = (event) => {
  const h = event?.headers || {}
  return h['x-org'] || h['X-Org'] || null
}

export const resolveOrg = (event) => {
  const claims = event?.requestContext?.authorizer?.jwt?.claims
  const orgs = parseOrgs(claims?.orgs)
  if (!orgs) return null

  const requested = headerOrg(event)
  if (requested && orgs[requested]) return requested

  const keys = Object.keys(orgs)
  if (keys.length === 1) return keys[0]

  return null
}
