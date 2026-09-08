// Append-only admin audit trail. recordAudit is best-effort: a logging failure
// must never fail the underlying action (it just logs to CloudWatch).

const actorOf = (claims) => ({
  email: claims?.email || '',
  name: claims?.name || claims?.email || ''
})

export const recordAudit = async (
  deps,
  { org, claims, action, targetType = null, targetId = null, targetLabel = null, meta = null }
) => {
  try {
    await deps.db.putAudit({
      org,
      entry: { actor: actorOf(claims), action, targetType, targetId, targetLabel, meta }
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('audit record failed', action, e?.message)
  }
}
