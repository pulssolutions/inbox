// The org's notification defaults, for admins who have made no choice of their
// own. Best-effort: a lookup failure falls back to the code defaults rather
// than dropping the mail.
export const notifyDefaults = async (deps, org) => {
  try {
    return await deps.db.getSettings({ org, group: 'notify' })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('notification defaults lookup failed', org, e?.message)
    return null
  }
}
