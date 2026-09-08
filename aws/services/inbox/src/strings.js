// Every string this service puts in an email, by locale.
//
// Scope is deliberate: EMAIL only. The agent web app stays Swedish for now.
// The boundary is "email" rather than "customer-facing" because an English
// deployment's agents are that company's own staff - shipping English replies
// to customers while their assignment notifications arrive in Swedish is worse
// than either language on its own.
//
// The reply BODY is written by an agent and never translated; what lives here
// is the generated chrome around it, plus the notification copy.
//
// Adding a locale = adding a key to LOCALES. Missing keys fall back to English
// rather than throwing, so a half-finished translation degrades instead of
// breaking mail delivery.

const en = {
  // -- email chrome (seen by customers) --
  ctaOpen: 'Open',
  automatedFrom: (org) => `This is an automated message from ${org}.`,

  // -- reminder sweep --
  reminderSubject: (subject) => `Reminder: ${subject}`,
  reminderHeading: 'This issue is still waiting for a reply',
  reminderQuiet: (days) => `The issue has been open for ${days} days with no activity.`,
  reminderAct: 'Reply to the sender and mark the issue done once it is resolved.',
  reminderLast: 'This is the final reminder.',

  // -- agent notifications --
  someAdmin: 'An administrator',
  subjectLine: (subject) => `Subject: ${subject}`,
  ctaOpenIssue: 'Open the issue',

  assignedSubject: (subject) => `You have been assigned an issue: ${subject}`,
  assignedHeading: 'You have been assigned an issue',
  assignedBody: (who) => `${who} assigned an issue to you.`,

  replySubject: (subject) => `New reply on an issue: ${subject}`,
  replyHeading: 'New reply on an issue',
  replyBody: (who) => `${who} replied on an issue.`,

  transferSubject: (to, subject) => `Issue moved to ${to}: ${subject}`,
  transferHeading: 'Issue moved here',
  transferBody: (who, from, to) => `${who} moved an issue from ${from} to ${to}.`,
  transferNote: (from, to, who) => `Issue moved from ${from} to ${to} by ${who}`,

  noteSubject: (subject) => `New internal note: ${subject}`,
  noteHeading: 'New internal note',
  noteBody: (who) => `${who} added an internal note.`,

  // -- validation surfaced to the agent UI --
  categoryUnchanged: 'The issue is already in that category',
  unknownAuthor: 'unknown'
}

const sv = {
  ctaOpen: 'Öppna',
  automatedFrom: (org) => `Detta är ett automatiskt meddelande från ${org}.`,

  reminderSubject: (subject) => `Påminnelse: ${subject}`,
  reminderHeading: 'Ärendet väntar fortfarande på svar',
  reminderQuiet: (days) => `Ärendet har varit öppet i ${days} dygn utan att något hänt.`,
  reminderAct: 'Svara avsändaren och markera ärendet som klart när det är avslutat.',
  reminderLast: 'Detta är den sista påminnelsen.',

  someAdmin: 'En administratör',
  subjectLine: (subject) => `Ämne: ${subject}`,
  ctaOpenIssue: 'Öppna ärendet',

  assignedSubject: (subject) => `Du har tilldelats ett ärende: ${subject}`,
  assignedHeading: 'Du har tilldelats ett ärende',
  assignedBody: (who) => `${who} har tilldelat dig ett ärende.`,

  replySubject: (subject) => `Nytt svar i ett ärende: ${subject}`,
  replyHeading: 'Nytt svar i ett ärende',
  replyBody: (who) => `${who} har svarat i ett ärende.`,

  transferSubject: (to, subject) => `Ärende flyttat till ${to}: ${subject}`,
  transferHeading: 'Ärende flyttat hit',
  transferBody: (who, from, to) => `${who} har flyttat ett ärende från ${from} till ${to}.`,
  transferNote: (from, to, who) => `Ärendet flyttades från ${from} till ${to} av ${who}`,

  noteSubject: (subject) => `Ny intern anteckning: ${subject}`,
  noteHeading: 'Ny intern anteckning',
  noteBody: (who) => `${who} har lagt till en intern anteckning.`,

  categoryUnchanged: 'Ärendet ligger redan i den kategorin',
  unknownAuthor: 'okänd'
}

const LOCALES = { en, sv }

export const DEFAULT_LOCALE = 'en'

// Strings for one locale, with English filling any gap. Reads LOCALE at call
// time rather than at import, so tests can set it per case.
export const strings = (locale = process.env.LOCALE) => {
  const table = LOCALES[String(locale || '').toLowerCase()]
  return table ? { ...en, ...table } : en
}

export const availableLocales = () => Object.keys(LOCALES)
