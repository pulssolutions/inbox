import { notifyRecipients } from './notify.js'
import { strings } from './strings.js'

const DAY_MS = 24 * 3600 * 1000
const MAX_REMINDERS = 5
// A reminder is due 24h after the last activity, but the daily schedule can fire
// slightly early or be re-run by hand; 20h keeps a same-day repeat from
// double-sending without needing an exactly-24h clock.
const MIN_GAP_MS = 20 * 3600 * 1000

// How many reminders already went out for the CURRENT silence. Activity after
// the last reminder means the thread moved on, so the count starts over — no
// other code path has to reset anything.
const remindersSent = (m) =>
  m.naggedAt && m.naggedAt > m.lastActivityAt ? m.nagCount || 0 : 0

const isDue = (m, now) => {
  if (m.state !== 'open' || m.box === 'archived') return false
  if ((m.threadId || m.messageId) !== m.messageId) return false // roots only
  const quietMs = now.getTime() - new Date(m.lastActivityAt).getTime()
  if (quietMs < DAY_MS) return false
  if (remindersSent(m) >= MAX_REMINDERS) return false
  if (m.naggedAt && now.getTime() - new Date(m.naggedAt).getTime() < MIN_GAP_MS) {
    return false
  }
  return true
}

// The assignee owns it if there is one; otherwise the whole category is on the
// hook (same recipient rule as a new issue, opt-out included).
const recipientsFor = (m, admins) =>
  m.assignee ? [m.assignee] : notifyRecipients(admins, m.category)

const remind = async (deps, { to, orgName, message, count, now }) => {
  const root = message.threadId || message.messageId
  const t = strings()
  const days = Math.floor((now.getTime() - new Date(message.lastActivityAt).getTime()) / DAY_MS)
  await deps.ses.sendNotification({
    to,
    orgName,
    subject: t.reminderSubject(message.subject || ''),
    heading: t.reminderHeading,
    paragraphs: [
      t.reminderQuiet(days),
      message.subject ? t.subjectLine(message.subject) : null,
      t.reminderAct,
      count === MAX_REMINDERS ? t.reminderLast : null
    ].filter(Boolean),
    // Hash route: the web app serves message deep-links at /#/m/:id.
    ctaUrl: deps.webBaseUrl ? `${deps.webBaseUrl}/#/m/${root}` : undefined,
    ctaLabel: t.ctaOpenIssue
  })
}

// Daily sweep: remind the responsible admins about issues left open, once a day,
// at most five times per silence. Runs for every tenant — there is no JWT here,
// so the org list comes from the tenant rows.
//
// ponytail: sends sequentially inside the Lambda's 15s timeout. Fine at club
// volume; batch or raise the timeout if the tenant count grows.
export const runNag = async (deps, now = new Date()) => {
  const tenants = await deps.db.listTenants()
  const orgs = new Map()
  for (const t of tenants) if (t.org && !orgs.has(t.org)) orgs.set(t.org, t.name || t.org)

  let scanned = 0
  let notified = 0
  for (const [org, orgName] of orgs) {
    const messages = await deps.db.listMessagesByBox({ org, box: 'inbox' })
    const due = messages.filter((m) => isDue(m, now))
    scanned += messages.length
    if (!due.length) continue
    const admins = await deps.db.listAdmins({ org })
    for (const message of due) {
      const count = remindersSent(message) + 1
      let sent = 0
      for (const to of recipientsFor(message, admins)) {
        try {
          await remind(deps, { to, orgName, message, count, now })
          sent += 1
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('reminder failed', message.messageId, to, e?.message)
        }
      }
      // Only count it as a reminder if someone actually got one — a total SES
      // failure should be retried tomorrow, not silently burn one of the five.
      if (!sent) continue
      notified += sent
      await deps.db.setMessageNag({
        org,
        messageId: message.messageId,
        count,
        at: now.toISOString()
      })
    }
  }
  return { scanned, notified }
}
