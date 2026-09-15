// Who gets notified about an issue in a given category: every active
// superadmin (they see all categories) plus active scoped admins whose
// `categories` list covers it. Deduped by lowercased email.
//
// Two events, two flags: `newIssue` is a brand-new issue, `reply` is any later
// activity on an existing one (a member's reply, a colleague's reply, note or
// transfer, and the reminder sweep). Assignment notifications are sent
// separately and ignore both.
//
// A flag resolves in three steps — the admin's own value, else the org
// default, else the code default below. Unset means inherit, so `null` and
// `undefined` are NOT "on".
//
// This logic is mirrored inline in the inbox-parse Lambda (which is
// dependency-free); it lives here so the rule itself is unit-tested, and
// test/notify-parity.test.mjs runs both copies over the same table.
export const NOTIFY_DEFAULTS = { newIssue: true, reply: false }

export const notifyPref = (admin, event, orgDefaults) => {
  const own = event === 'reply' ? admin.notifyReply : admin.notifyNewIssue
  if (typeof own === 'boolean') return own
  // A row written before the two flags were split has no `notifyReply` key at
  // all. Back then one flag governed both events and an absent flag meant on,
  // so reproduce exactly that — the reply default flipped from on to off, and
  // nobody's mail may change underneath them because of it. `newIssue` needs no
  // such branch: its default did not move.
  //
  // ponytail: delete once every row has been rewritten (create and update both
  // write the key now, so a row only reaches here if untouched since the split).
  if (event === 'reply' && admin.notifyReply === undefined) {
    return admin.notifyNewIssue !== false
  }
  const org = orgDefaults?.[event]
  return typeof org === 'boolean' ? org : NOTIFY_DEFAULTS[event]
}

export const notifyRecipients = (admins, category, options = {}) => {
  const { event = 'newIssue', orgDefaults } = options
  const out = []
  const seen = new Set()
  for (const a of admins || []) {
    if (!a || a.active === false) continue
    if (!notifyPref(a, event, orgDefaults)) continue
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
