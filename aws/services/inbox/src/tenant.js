import { domainSlug } from './keys.js'

// Resolve an email domain to a tenant org slug.
// Prefers an explicit ALL:tenant row; falls back to a domain slug so unknown
// mail is never lost (and surfaces a tenant that can be onboarded later).
export const resolveTenant = async (domain, db) => {
  const normalized = String(domain || '')
    .trim()
    .toLowerCase()
  if (!normalized) return null
  const tenant = await db.getTenant({ domain: normalized })
  if (tenant?.org) return tenant.org
  return domainSlug(normalized) || null
}

// Which of OUR domains a message was addressed to, from its To/Cc list. The
// caller supplies the domains it will accept, so an attacker-controlled header
// can never name a domain we do not already own - it only ever selects among
// them.
//
// Shared because two things must agree on it: a reply goes out from the domain
// the customer wrote to, and a reminder is branded as that domain's tenant.
// Answering from - or branding as - a different one of our domains than they
// addressed reads as a different company, or as phishing.
export const addressedDomain = (to, domains) => {
  const ours = (domains || []).map((d) => String(d).trim().toLowerCase()).filter(Boolean)
  if (!ours.length) return null
  for (const entry of Array.isArray(to) ? to : [to]) {
    const address = String(entry || '').match(/<([^>]*)>/)?.[1] ?? String(entry || '')
    const domain = address.split('@')[1]?.trim().toLowerCase()
    if (domain && ours.includes(domain)) return domain
  }
  return null
}
