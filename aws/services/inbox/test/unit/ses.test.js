import { describe, it, expect } from 'vitest'
import { Ses, buildEmail } from '../../src/ses.js'

const captureClient = () => ({
  commands: [],
  async send(cmd) {
    this.commands.push(cmd)
    return { MessageId: 'sent-1' }
  }
})

const rawOf = (cmd) => Buffer.from(cmd.input.RawMessage.Data).toString('utf8')

describe('buildEmail (themed wrapper)', () => {
  it('returns html + plain-text alternatives carrying org name and paragraphs', () => {
    const { html, text } = buildEmail({
      orgName: 'Acme BK',
      heading: 'Nytt ärende',
      paragraphs: ['Anna skrev till kurser.', 'Ämne: Valpkurs']
    })
    expect(html).toContain('Acme BK')
    expect(html).toContain('Nytt ärende')
    expect(html).toContain('Anna skrev till kurser.')
    expect(text).toContain('Nytt ärende')
    expect(text).toContain('Anna skrev till kurser.')
  })

  it('never embeds images (works for any org)', () => {
    const { html } = buildEmail({ orgName: 'X', heading: 'H', paragraphs: ['p'] })
    expect(html).not.toMatch(/<img/i)
    expect(html).not.toMatch(/background-image/i)
  })

  it('renders a CTA button + link when ctaUrl is given', () => {
    const { html, text } = buildEmail({
      orgName: 'X',
      heading: 'H',
      paragraphs: ['p'],
      ctaUrl: 'https://dev.inbox.apps.acme.example/m/abc',
      ctaLabel: 'Öppna ärendet'
    })
    expect(html).toContain('href="https://dev.inbox.apps.acme.example/m/abc"')
    expect(html).toContain('Öppna ärendet')
    expect(text).toContain('https://dev.inbox.apps.acme.example/m/abc')
  })

  it('escapes HTML in user-supplied content', () => {
    const { html } = buildEmail({
      orgName: 'X',
      heading: 'H',
      paragraphs: ['<script>alert(1)</script>']
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('omits the dark header band when showHeader is false', () => {
    const withHeader = buildEmail({ orgName: 'Klubben', paragraphs: ['p'] }).html
    expect(withHeader).toContain('background:#1f2430')
    const noHeader = buildEmail({ orgName: 'Klubben', paragraphs: ['p'], showHeader: false }).html
    expect(noHeader).not.toContain('background:#1f2430')
  })

  it('links the org name in the footer when footerUrl is given', () => {
    const { html } = buildEmail({
      orgName: 'Acme Ltd',
      paragraphs: ['p'],
      showHeader: false,
      footerUrl: 'https://www.acme.example'
    })
    expect(html).toContain('href="https://www.acme.example"')
    expect(html).toContain('Acme Ltd')
    expect(html).not.toContain('automatiskt meddelande')
  })

  it('uses the generic automatic-message footer without footerUrl', () => {
    const { html } = buildEmail({ orgName: 'Klubben', paragraphs: ['p'] })
    expect(html).toContain('automatiskt meddelande från Klubben')
  })
})

describe('Ses', () => {
  it('requires client and fromAddress', () => {
    expect(() => new Ses({})).toThrow()
    expect(() => new Ses({ client: {} })).toThrow()
  })

  it('sendPlainText uses SendEmailCommand from the configured sender', async () => {
    const client = captureClient()
    const ses = new Ses({ client, fromAddress: 'support@acme.example' })
    await ses.sendPlainText({ to: 'a@b.se', subject: 'Hi', body: 'Yo' })
    const cmd = client.commands[0]
    expect(cmd.constructor.name).toBe('SendEmailCommand')
    expect(cmd.input.Source).toBe('support@acme.example')
    expect(cmd.input.Destination.ToAddresses).toEqual(['a@b.se'])
  })

  describe('sendReply', () => {
    it('sends raw MIME with From/To/Reply-To and In-Reply-To/References', async () => {
      const client = captureClient()
      const ses = new Ses({ client, fromAddress: 'support@acme.example' })
      await ses.sendReply({
        to: 'Anna <anna@example.se>',
        subject: 'Re: Fraga',
        body: 'Tack for din fraga!',
        inReplyTo: 'orig-123'
      })
      const cmd = client.commands[0]
      expect(cmd.constructor.name).toBe('SendRawEmailCommand')
      expect(cmd.input.Source).toBe('support@acme.example')
      expect(cmd.input.Destinations).toEqual(['anna@example.se'])
      const raw = rawOf(cmd)
      expect(raw).toContain('From: support@acme.example')
      expect(raw).toContain('To: Anna <anna@example.se>')
      expect(raw).toContain('Reply-To: support@acme.example')
      expect(raw).toContain('In-Reply-To: <orig-123>')
      expect(raw).toContain('References: <orig-123>')
      expect(raw).toContain('Tack for din fraga!')
    })

    it('RFC2047-encodes a non-ASCII subject', async () => {
      const client = captureClient()
      const ses = new Ses({ client, fromAddress: 'support@acme.example' })
      await ses.sendReply({ to: 'a@b.se', subject: 'Re: Hälsning', body: 'x' })
      const raw = rawOf(client.commands[0])
      expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/)
    })

    it('does not duplicate angle brackets on an already-bracketed id', async () => {
      const client = captureClient()
      const ses = new Ses({ client, fromAddress: 'support@acme.example' })
      await ses.sendReply({ to: 'a@b.se', subject: 'Re', body: 'x', inReplyTo: '<abc>' })
      expect(rawOf(client.commands[0])).toContain('In-Reply-To: <abc>')
    })

    it('sends from a category alias with an encoded display name', async () => {
      const client = captureClient()
      const ses = new Ses({ client, fromAddress: 'support@acme.example' })
      await ses.sendReply({
        to: 'a@b.se',
        subject: 'Re',
        body: 'x',
        fromName: 'Acme Lösningar - Kurser',
        fromAddress: 'kurser@acme.example'
      })
      const cmd = client.commands[0]
      expect(cmd.input.Source).toBe('kurser@acme.example')
      const r = rawOf(cmd)
      // Display name is non-ASCII (å) → RFC2047-encoded inside quotes.
      expect(r).toMatch(/From: "=\?UTF-8\?B\?[^"]+" <kurser@acme\.example>/)
      expect(r).toContain('Reply-To: "=?UTF-8?B?')
    })

    it('falls back to the configured sender when no fromAddress given', async () => {
      const client = captureClient()
      const ses = new Ses({ client, fromAddress: 'support@acme.example' })
      await ses.sendReply({ to: 'a@b.se', subject: 'Re', body: 'x' })
      expect(client.commands[0].input.Source).toBe('support@acme.example')
      expect(rawOf(client.commands[0])).toContain('From: support@acme.example')
    })

    it('sends multipart/alternative: raw text + themed html, no header band, linked footer', async () => {
      const client = captureClient()
      const ses = new Ses({ client, fromAddress: 'support@acme.example' })
      await ses.sendReply({
        to: 'a@b.se',
        subject: 'Re',
        body: 'Tack för din fråga!',
        fromName: 'Acme Lösningar - Kurser',
        fromAddress: 'kurser@acme.example',
        orgName: 'Acme Ltd',
        website: 'https://www.acme.example'
      })
      const raw = rawOf(client.commands[0])
      expect(raw).toContain('Content-Type: multipart/alternative')
      expect(raw).toContain('Content-Type: text/plain; charset=utf-8')
      expect(raw).toContain('Content-Type: text/html; charset=utf-8')
      // raw text part preserves the admin's reply verbatim
      expect(raw).toContain('Tack för din fråga!')
      // member-facing: no dark header band; footer links the club name
      expect(raw).not.toContain('background:#1f2430')
      expect(raw).toContain('href="https://www.acme.example"')
    })
  })

  describe('sendNotification', () => {
    it('sends a themed raw email from the configured sender', async () => {
      const client = captureClient()
      const ses = new Ses({ client, fromAddress: 'support@acme.example' })
      await ses.sendNotification({
        to: 'admin@x.se',
        orgName: 'Acme BK',
        subject: 'Du har tilldelats ett ärende',
        heading: 'Tilldelat ärende',
        paragraphs: ['Boss tilldelade dig ett ärende.'],
        ctaUrl: 'https://dev.inbox.apps.acme.example/m/abc',
        ctaLabel: 'Öppna'
      })
      const cmd = client.commands[0]
      expect(cmd.constructor.name).toBe('SendRawEmailCommand')
      expect(cmd.input.Source).toBe('support@acme.example')
      expect(cmd.input.Destinations).toEqual(['admin@x.se'])
      const raw = rawOf(cmd)
      expect(raw).toContain('To: admin@x.se')
      expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/) // non-ASCII subject encoded
      expect(raw).toContain('Content-Type: multipart/alternative')
      expect(raw).toContain('Tilldelat ärende')
      expect(raw).toContain('href="https://dev.inbox.apps.acme.example/m/abc"')
      // No notifyFromName configured → bare From, no display name.
      expect(raw).toContain('From: support@acme.example')
    })

    it('shows the friendly notifyFromName while keeping the bare envelope sender', async () => {
      const client = captureClient()
      const ses = new Ses({
        client,
        fromAddress: 'support@acme.example',
        notifyFromName: 'Acme Ärenden'
      })
      await ses.sendNotification({
        to: 'admin@x.se',
        orgName: 'Acme BK',
        subject: 'Nytt ärende',
        heading: 'Nytt ärende',
        paragraphs: ['Anna skrev till kurser.']
      })
      const cmd = client.commands[0]
      // Envelope sender stays bare (SES Source must be an address).
      expect(cmd.input.Source).toBe('support@acme.example')
      const raw = rawOf(cmd)
      // Non-ASCII display name is RFC 2047-encoded in the From header.
      const encoded = `=?UTF-8?B?${Buffer.from('Acme Ärenden', 'utf8').toString('base64')}?=`
      expect(raw).toContain(`From: "${encoded}" <support@acme.example>`)
    })
  })
})
