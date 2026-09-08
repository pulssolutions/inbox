// Read the org's audit log (superadmin only — gated by audit.read). Whole-org,
// newest-first; no category scoping.
export const list = async ({ deps, org, query = {} }) => {
  const limit = Math.min(Number(query.limit) || 200, 500)
  return deps.db.listAudit({ org, limit })
}
