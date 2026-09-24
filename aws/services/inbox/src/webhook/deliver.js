import { renderTemplate, renderEnvelope } from '../webhook.js'
import { resolve } from '../settings/groups.js'

// What the Test button posts. A fixed fixture rather than the org's newest mail:
// an admin trying out a template should not send a customer's message to a URL
// they are still typing.
export const SAMPLE_MESSAGE = {
  messageId: 'sample',
  threadId: 'sample',
  category: 'test',
  from: 'Anna Andersson <anna@example.se>',
  subject: 'Testmeddelande från Inbox',
  receivedAt: new Date(0).toISOString(),
  body: 'Så här ser ett inkommande meddelande ut.'
}

// The reply address, not the From: header. A mailing list that rewrites From:
// - Google Groups does it for every sender whose domain publishes DMARC - puts
// the list in From: and the human in Reply-To, so naming From: in the chat room
// would credit every customer mail to the list. Same rule as replies use.
const senderOf = (parsed, message) => parsed?.replyTo || message.from || ''

// Whether this message is one the org asked to be told about. A reply is any
// message that is not its own thread root.
const wanted = (webhook, message) =>
  (message.threadId || message.messageId) === message.messageId
    ? webhook.onNewIssue
    : webhook.onReply

// Reads the body out of the stored MIME. Read-time parsing is what strips the
// Google Groups unsubscribe footer, so the chat room shows what the customer
// wrote rather than what the list appended.
const bodyOf = async (deps, message) => {
  if (message.body !== undefined) return { body: message.body, parsed: null }
  if (!message.s3Key) return { body: '', parsed: null }
  try {
    const parsed = await deps.mailStore.fetchAndParse({
      bucket: message.s3Bucket,
      key: message.s3Key
    })
    return { body: parsed.text || '', parsed }
  } catch (e) {
    // An unreadable object should still announce the message; the link in the
    // template leads to the thread either way.
    // eslint-disable-next-line no-console
    console.error('webhook body read failed', message.messageId, e?.message)
    return { body: '', parsed: null }
  }
}

// Renders and posts one message. Answers how it went rather than throwing, so
// the stream adapter decides what is worth a retry.
export const deliver = async ({ deps, org, message, webhook }) => {
  const settings = webhook ?? resolve('webhook', await deps.db.getSettings({ org, group: 'webhook' }))
  if (!settings.url) return { delivered: false, reason: 'not-configured' }
  if (!wanted(settings, message)) return { delivered: false, reason: 'not-subscribed' }

  const { body, parsed } = await bodyOf(deps, message)
  const threadId = message.threadId || message.messageId
  const content = renderTemplate(settings.template, {
    ...message,
    orgName: message.orgName || org,
    from: senderOf(parsed, message),
    body,
    url: deps.webBaseUrl ? `${deps.webBaseUrl}/#/m/${threadId}` : ''
  })

  try {
    const res = await deps.webhook.post({
      url: settings.url,
      token: settings.token,
      body: renderEnvelope(settings.envelope, content)
    })
    if (!res.ok) return { delivered: false, status: res.status, error: `HTTP ${res.status}` }
    return { delivered: true, status: res.status }
  } catch (e) {
    return { delivered: false, error: e?.message || 'request failed' }
  }
}
