// Who gets notified about an issue in a given category: every active
// superadmin (they see all categories) plus active scoped admins whose
// `categories` list covers it. Deduped by lowercased email.
//
// Admins who opted out of new-issue/reply mail (notifyNewIssue === false) are
// skipped — assignment notifications are sent separately and ignore this.
//
// This logic is mirrored inline in the inbox-parse Lambda (which is
// dependency-free); it lives here so the rule itself is unit-tested.
export const notifyRecipients = (admins, category) => {
  const out = []
  const seen = new Set()
  for (const a of admins || []) {
    if (!a || a.active === false) continue
    if (a.notifyNewIssue === false) continue
    const email = String(a.email || '').toLowerCase()
    if (!email) continue
    const covers =
      a.role === 'superadmin' ||
      (Array.isArray(a.categories) && a.categories.includes(category))
    if (!covers || seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}
