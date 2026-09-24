import { ValidationError } from './errors.js'

// A webhook template is typed into a form by an admin, so the render has two
// jobs beyond substitution: customer content must never become markup, and the
// author must not be able to produce a request body the receiver rejects as
// malformed. Those are the two escape rules below, and they are why this needs
// no template engine - there are no loops or conditions in a flat message.

// The body is quoted into HTML, so it is escaped and its newlines become
// breaks. Long mail would push the receiver's own size limit, and nobody reads
// a thousand lines in a chat room.
export const BODY_LIMIT = 2000

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const truncate = (text, limit) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text

const nameOf = (address) => {
  const value = String(address || '').trim()
  const named = value.match(/^\s*"?([^"<]*?)"?\s*</)
  return named ? named[1].trim() : addressOf(value)
}

const addressOf = (address) => {
  const value = String(address || '').trim()
  return value.match(/<([^>]*)>/)?.[1]?.trim() ?? value
}

// Every placeholder a template may use, and what each one means. One name, one
// meaning: `from` is always the display form and `fromEmail` always the bare
// address, so a template never has to guess which it got.
export const PLACEHOLDERS = {
  subject: (m) => m.subject || '',
  from: (m) => m.from || '',
  fromName: (m) => nameOf(m.from),
  fromEmail: (m) => addressOf(m.from),
  category: (m) => m.category || '',
  orgName: (m) => m.orgName || '',
  messageId: (m) => m.messageId || '',
  threadId: (m) => m.threadId || m.messageId || '',
  url: (m) => m.url || '',
  receivedAt: (m) => m.receivedAt || '',
  body: (m) => truncate(String(m.body || ''), BODY_LIMIT)
}

const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g

// Renders the content an admin authored. Substituted values are HTML-escaped -
// a subject of `<script>` is text in the chat room, never markup - while the
// template's own tags are left exactly as written.
export const renderTemplate = (template, message) =>
  String(template ?? '').replace(PLACEHOLDER_RE, (_, name) => {
    const resolve = PLACEHOLDERS[name]
    return resolve ? escapeHtml(resolve(message)) : ''
  })

// Renders the JSON request body around that content. The receiver decides the
// shape - Basecamp Campfire and Discord take {"content": …}, Slack and Teams
// take {"text": …} - so it is one more field rather than one more deploy.
// JSON.stringify gives back a quoted string, and the envelope already carries
// the quotes, so the slice drops them: the author cannot emit invalid JSON
// whatever the message contains.
export const renderEnvelope = (envelope, content) =>
  String(envelope ?? '').replace(PLACEHOLDER_RE, (whole, name) =>
    name === 'content' ? JSON.stringify(String(content)).slice(1, -1) : whole
  )

// Hosts a webhook may never point at. The Lambda has no VPC and no instance
// metadata, so this is defence in depth rather than the only thing standing
// between an admin-typed URL and something internal - but a URL the server
// fetches on request is exactly the shape that earns the check.
const BLOCKED_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i

export const validateWebhookUrl = (url) => {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    throw new ValidationError('WEBHOOK_INVALID', 'url must be a URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new ValidationError('WEBHOOK_INVALID', 'url must be https')
  }
  if (BLOCKED_HOST.test(parsed.hostname)) {
    throw new ValidationError('WEBHOOK_INVALID', 'url must not be a private address')
  }
}

// Names every placeholder the template uses that does not exist. The full set
// is known, so a typo should fail in the form rather than render as a silent
// blank for the rest of the deployment's life.
export const unknownPlaceholders = (template) => {
  const seen = new Set()
  for (const [, name] of String(template ?? '').matchAll(PLACEHOLDER_RE)) {
    if (!Object.hasOwn(PLACEHOLDERS, name)) seen.add(name)
  }
  return [...seen]
}

export class Webhook {
  // fetch is injected rather than reached for, so the tests exercise the real
  // request shape against a fake instead of the network.
  constructor({ fetch: transport = globalThis.fetch, timeoutMs = 5000 } = {}) {
    this.fetch = transport
    this.timeoutMs = timeoutMs
  }

  // Answers how it went instead of throwing, so the caller decides whether a
  // failed post is worth a stream retry.
  async post({ url, token, body }) {
    const headers = { 'content-type': 'application/json' }
    if (token) headers['x-inbox-token'] = token
    const res = await this.fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    return { ok: res.ok, status: res.status }
  }
}
