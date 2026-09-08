import { randomBytes } from 'node:crypto'
import { SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses'
import { splitAddress } from './keys.js'
import { strings } from './strings.js'

const isAscii = (s) => /^[\x00-\x7F]*$/.test(s)

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// A simple, image-free themed wrapper for any org's outgoing mail. Inline CSS
// only (mail clients strip <style>/external CSS). Returns both an HTML body and
// a plain-text alternative built from the same parts.
export const buildEmail = ({
  orgName = '',
  heading = '',
  paragraphs = [],
  ctaUrl,
  ctaLabel,
  // Replies to members hide the dark header band and use an org-specific
  // footer (name linked to the club site); admin notifications keep both.
  showHeader = true,
  footerUrl
} = {}) => {
  const t = strings()
  const label = ctaLabel || t.ctaOpen
  const paras = (Array.isArray(paragraphs) ? paragraphs : [paragraphs]).filter(
    (p) => p != null && String(p).length > 0
  )
  const paraHtml = paras
    .map(
      (p) =>
        `<p style="margin:0 0 14px;color:#1f2430;font-size:15px;line-height:1.55">${escapeHtml(
          p
        ).replace(/\n/g, '<br>')}</p>`
    )
    .join('')
  const headingHtml = heading
    ? `<h1 style="margin:0 0 16px;color:#1f2430;font-size:19px;font-weight:600">${escapeHtml(
        heading
      )}</h1>`
    : ''
  const ctaHtml = ctaUrl
    ? `<p style="margin:22px 0 4px"><a href="${escapeHtml(
        ctaUrl
      )}" style="display:inline-block;background:#e0a32e;color:#1f2430;text-decoration:none;font-weight:600;padding:11px 22px;border-radius:8px;font-size:15px">${escapeHtml(
        label
      )}</a></p>`
    : ''
  const headerHtml = showHeader
    ? `<tr><td style="background:#1f2430;padding:18px 28px"><span style="color:#e0a32e;font-size:16px;font-weight:700;letter-spacing:.3px">${escapeHtml(
        orgName
      )}</span></td></tr>`
    : ''
  const footerName = escapeHtml(orgName)
  const footerInner = footerUrl
    ? `<a href="${escapeHtml(
        footerUrl
      )}" style="color:#8a909c;text-decoration:underline">${footerName}</a>`
    : t.automatedFrom(footerName)
  const html = `<!doctype html><html><body style="margin:0;background:#f2f3f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e7ea">
${headerHtml}
<tr><td style="padding:26px 28px">${headingHtml}${paraHtml}${ctaHtml}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #eceef1"><span style="color:#8a909c;font-size:12px">${footerInner}</span></td></tr>
</table></body></html>`

  const textParts = []
  if (heading) textParts.push(heading)
  for (const p of paras) textParts.push(p)
  if (ctaUrl) textParts.push(`${label}: ${ctaUrl}`)
  const text = textParts.join('\n\n')
  return { html, text }
}

// RFC 2047 encoded-word for non-ASCII header values (subjects).
const encodeHeaderValue = (value) => {
  const v = value ?? ''
  if (isAscii(v)) return v
  return `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`
}

const angled = (id) => {
  const v = String(id).trim()
  return v.startsWith('<') ? v : `<${v}>`
}

// Extract the bare envelope recipient from a possibly display-named address.
const bareAddress = (addr) => {
  const { local, domain } = splitAddress(addr)
  return local && domain ? `${local}@${domain}` : addr
}

export class Ses {
  constructor({ client, fromAddress, notifyFromName }) {
    if (!client) throw new Error('SES client required')
    if (!fromAddress) throw new Error('fromAddress required')
    this.client = client
    this.fromAddress = fromAddress
    // Friendly From display name for admin notifications (e.g. "Acme Inbox").
    // Optional — falls back to the bare address when unset.
    this.notifyFromName = notifyFromName || null
  }

  async sendPlainText({ to, subject, body }) {
    const cmd = new SendEmailCommand({
      Source: this.fromAddress,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Charset: 'UTF-8', Data: subject },
        Body: { Text: { Charset: 'UTF-8', Data: body } }
      }
    })
    return this.client.send(cmd)
  }

  // Build a multipart/alternative raw MIME message (text + themed html) and
  // send it via SendRawEmail (the only way to set threading headers + html).
  async _sendRaw({ from, to, subject, text, html, extraHeaders = [] }) {
    const boundary = `==_puls_${randomBytes(12).toString('hex')}`
    const headers = [
      `From: ${from}`,
      `To: ${to}`,
      `Reply-To: ${from}`,
      `Subject: ${encodeHeaderValue(subject)}`,
      'MIME-Version: 1.0',
      ...extraHeaders,
      `Content-Type: multipart/alternative; boundary="${boundary}"`
    ]
    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      text,
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      html,
      `--${boundary}--`,
      ''
    ].join('\r\n')

    const raw = `${headers.join('\r\n')}\r\n\r\n${body}`
    return this.client.send(
      new SendRawEmailCommand({
        Source: bareAddress(from),
        Destinations: [bareAddress(to)],
        RawMessage: { Data: Buffer.from(raw, 'utf8') }
      })
    )
  }

  // Reply with proper threading headers (In-Reply-To / References). The text
  // part is the admin's verbatim reply; the html part is the themed wrapper.
  async sendReply({
    to,
    subject,
    body,
    inReplyTo,
    references,
    fromName,
    fromAddress,
    orgName: footerOrgName,
    website
  }) {
    // Default to the configured sender; callers pass a category alias
    // (e.g. kurser@example.com) so replies thread back to that inbox.
    const addr = fromAddress || this.fromAddress
    const from = fromName ? `"${encodeHeaderValue(fromName)}" <${addr}>` : addr
    const extraHeaders = []
    if (inReplyTo) extraHeaders.push(`In-Reply-To: ${angled(inReplyTo)}`)
    const refs = references || inReplyTo
    if (refs) extraHeaders.push(`References: ${angled(refs)}`)

    // Member-facing: no header band; footer is the club name linked to its site.
    // orgName is supplied by the caller (derived per-tenant); no club hardcoded.
    const { html } = buildEmail({
      orgName: footerOrgName || fromName || '',
      paragraphs: String(body).split(/\n\s*\n/),
      showHeader: false,
      footerUrl: website
    })
    return this._sendRaw({
      from,
      to,
      subject,
      text: body,
      html,
      extraHeaders
    })
  }

  // A themed transactional notification from the configured sender (no
  // threading). Used for admin alerts (new issue, assignment).
  async sendNotification({
    to,
    orgName,
    subject,
    heading,
    paragraphs,
    ctaUrl,
    ctaLabel
  }) {
    const { html, text } = buildEmail({
      orgName,
      heading,
      paragraphs,
      ctaUrl,
      ctaLabel
    })
    const from = this.notifyFromName
      ? `"${encodeHeaderValue(this.notifyFromName)}" <${this.fromAddress}>`
      : this.fromAddress
    return this._sendRaw({ from, to, subject, text, html })
  }
}
