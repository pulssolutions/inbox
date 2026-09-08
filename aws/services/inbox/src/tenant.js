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
