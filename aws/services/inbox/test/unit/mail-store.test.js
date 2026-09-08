import { describe, it, expect } from 'vitest'
import { MailStore } from '../../src/mail-store.js'

// Fake S3 client: returns the seeded raw MIME Buffer as the object Body.
const fakeClient = (rawByKey) => ({
  calls: [],
  async send(cmd) {
    this.calls.push(cmd.input)
    const raw = rawByKey[cmd.input.Key]
    if (raw === undefined) {
      const err = new Error('NoSuchKey')
      err.name = 'NoSuchKey'
      throw err
    }
    return { Body: Buffer.from(raw, 'utf8') }
  }
})

const PLAIN = [
  'From: Anna <anna@example.se>',
  'To: kurser@acme.example',
  'Subject: Fraga om kurs',
  'Date: Mon, 01 Jun 2026 10:00:00 +0000',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hej! Nar startar nasta kurs?',
  ''
].join('\r\n')

const QUOTED_PRINTABLE = [
  'From: Bjorn <bjorn@example.se>',
  'To: support@acme.example',
  'Subject: Hälsning',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'V=C3=A4lkommen till Acme!',
  ''
].join('\r\n')

const MULTIPART = [
  'From: Cecilia <cissi@example.se>',
  'To: styrelse@acme.example',
  'Subject: Mote',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Plain version',
  '--b1',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>HTML version</p>',
  '--b1--',
  ''
].join('\r\n')

const WITH_ATTACHMENT = [
  'From: Dan <dan@example.se>',
  'To: kurser@acme.example',
  'Subject: Bilaga',
  'Content-Type: multipart/mixed; boundary="x1"',
  '',
  '--x1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Se bifogad fil',
  '--x1',
  'Content-Type: text/plain; name="note.txt"',
  'Content-Disposition: attachment; filename="note.txt"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('hello attachment', 'utf8').toString('base64'),
  '--x1--',
  ''
].join('\r\n')

describe('MailStore.fetchAndParse', () => {
  it('parses a plain text message into normalized fields', async () => {
    const store = new MailStore({
      client: fakeClient({ 'inbound/m1': PLAIN }),
      defaultBucket: 'b'
    })
    const mail = await store.fetchAndParse({ bucket: 'b', key: 'inbound/m1' })
    expect(mail.from).toContain('anna@example.se')
    expect(mail.subject).toBe('Fraga om kurs')
    expect(mail.text.trim()).toBe('Hej! Nar startar nasta kurs?')
    expect(mail.html).toBeNull()
    expect(mail.attachments).toEqual([])
  })

  it('decodes quoted-printable UTF-8 bodies', async () => {
    const store = new MailStore({ client: fakeClient({ k: QUOTED_PRINTABLE }) })
    const mail = await store.fetchAndParse({ bucket: 'b', key: 'k' })
    expect(mail.text.trim()).toBe('Välkommen till Acme!')
  })

  it('returns both text and html for multipart/alternative', async () => {
    const store = new MailStore({ client: fakeClient({ k: MULTIPART }) })
    const mail = await store.fetchAndParse({ bucket: 'b', key: 'k' })
    expect(mail.text.trim()).toBe('Plain version')
    expect(mail.html).toContain('HTML version')
  })

  it('surfaces attachment metadata without raw content', async () => {
    const store = new MailStore({ client: fakeClient({ k: WITH_ATTACHMENT }) })
    const mail = await store.fetchAndParse({ bucket: 'b', key: 'k' })
    expect(mail.attachments).toHaveLength(1)
    expect(mail.attachments[0]).toMatchObject({
      filename: 'note.txt',
      contentType: 'text/plain'
    })
    expect(mail.attachments[0].content).toBeUndefined()
  })

  it('does not resolve inline/related images as bodies', async () => {
    const store = new MailStore({ client: fakeClient({ k: WITH_ATTACHMENT }) })
    const mail = await store.fetchAndParse({ bucket: 'b', key: 'k' })
    expect(mail.text.trim()).toBe('Se bifogad fil')
  })

  it('uses defaultBucket when bucket not given', async () => {
    const client = fakeClient({ k: PLAIN })
    const store = new MailStore({ client, defaultBucket: 'fallback' })
    await store.fetchAndParse({ key: 'k' })
    expect(client.calls[0].Bucket).toBe('fallback')
  })

  it('propagates a not-found error', async () => {
    const store = new MailStore({ client: fakeClient({}), defaultBucket: 'b' })
    await expect(
      store.fetchAndParse({ bucket: 'b', key: 'missing' })
    ).rejects.toThrow()
  })
})

describe('MailStore.fetchAttachment', () => {
  it('returns the decoded bytes for the requested index', async () => {
    const store = new MailStore({ client: fakeClient({ k: WITH_ATTACHMENT }) })
    const found = await store.fetchAttachment({
      bucket: 'b',
      key: 'k',
      index: 0
    })
    expect(found.filename).toBe('note.txt')
    expect(found.contentType).toBe('text/plain')
    // base64 in the wire format, real bytes out.
    expect(found.content.toString('utf8')).toBe('hello attachment')
    expect(found.size).toBe('hello attachment'.length)
  })

  it('indexes match the list fetchAndParse returned', async () => {
    const store = new MailStore({ client: fakeClient({ k: WITH_ATTACHMENT }) })
    const mail = await store.fetchAndParse({ bucket: 'b', key: 'k' })
    const found = await store.fetchAttachment({
      bucket: 'b',
      key: 'k',
      index: 0
    })
    expect(found.filename).toBe(mail.attachments[0].filename)
  })

  it('returns null for an index the mail does not have', async () => {
    const store = new MailStore({ client: fakeClient({ k: WITH_ATTACHMENT }) })
    expect(
      await store.fetchAttachment({ bucket: 'b', key: 'k', index: 2 })
    ).toBeNull()
  })

  it('returns null for a mail with no attachments at all', async () => {
    const store = new MailStore({ client: fakeClient({ k: PLAIN }) })
    expect(
      await store.fetchAttachment({ bucket: 'b', key: 'k', index: 0 })
    ).toBeNull()
  })
})

// A phone photo pasted inline: mailparser turns the cid: reference into a data:
// URI, which used to blow the whole message past API Gateway's 6 MB limit.
const BIG_INLINE = (() => {
  const b64 = Buffer.alloc(200000, 1).toString('base64')
  return [
    'From: Elisa <elisa@example.se>',
    'To: webmaster@acme.example',
    'Subject: Bild',
    'Content-Type: multipart/related; boundary="r1"',
    '',
    '--r1',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Se bilden</p><img src="cid:img1">',
    '--r1',
    'Content-Type: image/png',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <img1>',
    'Content-Disposition: inline; filename="photo.png"',
    '',
    b64,
    '--r1--',
    ''
  ].join('\r\n')
})()

describe('MailStore inline images', () => {
  it('strips oversized inline data: URIs but keeps the attachment listed', async () => {
    const store = new MailStore({ client: fakeClient({ k: BIG_INLINE }) })
    const mail = await store.fetchAndParse({ bucket: 'b', key: 'k' })
    expect(mail.html).toContain('Se bilden')
    expect(mail.html.length).toBeLessThan(10000)
    expect(mail.attachments[0].filename).toBe('photo.png')
  })
})
