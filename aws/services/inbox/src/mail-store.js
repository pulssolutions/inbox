import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { simpleParser } from 'mailparser'

// Read raw MIME from S3 and parse it on demand. The S3 client is injected so the
// region (eu-west-1, where the inbox-mail bucket lives) is configured by the
// caller; the API Lambda runs in eu-north-1 and reads cross-region.

const asciiName = (name) => String(name).replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')

const toBuffer = async (body) => {
  if (!body) return Buffer.alloc(0)
  if (Buffer.isBuffer(body)) return body
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray())
  }
  const chunks = []
  for await (const c of body) chunks.push(c)
  return Buffer.concat(chunks)
}

// mailparser rewrites cid: references into inline data: URIs, so a mail with a
// 7 MB photo yields a ~10 MB html body — past API Gateway's 6 MB response limit,
// which made the whole message unopenable. Drop the oversized ones; the image is
// still downloadable from the attachments list.
const DATA_URI_MAX = 100000
const URI_END = new Set(['"', "'", ')', ' ', '>', '\n', '\r', '\t'])
// Scanned by hand rather than by regex: a 10 MB single-token match blows the
// regex engine's stack.
const stripBigDataUris = (html) => {
  if (!html) return html
  let out = ''
  let i = 0
  for (;;) {
    const start = html.indexOf('data:', i)
    if (start === -1) return out + html.slice(i)
    let end = start
    while (end < html.length && !URI_END.has(html[end])) end++
    out += html.slice(i, start)
    if (end - start <= DATA_URI_MAX) out += html.slice(start, end)
    i = end
  }
}

const normalize = (mail) => ({
  from: mail.from?.text ?? null,
  to: mail.to?.text ?? null,
  subject: mail.subject ?? null,
  date: mail.date ? mail.date.toISOString() : null,
  text: mail.text ?? '',
  html: stripBigDataUris(mail.html) || null,
  attachments: (mail.attachments || []).map((a) => ({
    filename: a.filename ?? null,
    contentType: a.contentType ?? null,
    size: a.size ?? null
  }))
})

export class MailStore {
  constructor({ client, defaultBucket }) {
    if (!client) throw new Error('S3 client required')
    this.client = client
    this.defaultBucket = defaultBucket
  }

  async fetchRaw({ bucket, key }) {
    const obj = await this.client.send(
      new GetObjectCommand({ Bucket: bucket || this.defaultBucket, Key: key })
    )
    return toBuffer(obj.Body)
  }

  async fetchAndParse({ bucket, key }) {
    const raw = await this.fetchRaw({ bucket, key })
    const mail = await simpleParser(raw)
    return normalize(mail)
  }

  // One attachment's bytes, addressed by its position in the list that
  // fetchAndParse() returned — normalize() maps that same mail.attachments
  // array in order, so the index the client saw is the index here. Kept out of
  // fetchAndParse so opening a thread never drags megabytes of PDF through the
  // Lambda. Returns null when the index doesn't exist.
  async fetchAttachment({ bucket, key, index }) {
    const raw = await this.fetchRaw({ bucket, key })
    const mail = await simpleParser(raw)
    const found = (mail.attachments || [])[index]
    if (!found) return null
    const content = Buffer.isBuffer(found.content)
      ? found.content
      : Buffer.from(found.content || [])
    return {
      filename: found.filename ?? null,
      // Browsers need something to save the file as; octet-stream downloads.
      contentType: found.contentType || 'application/octet-stream',
      size: content.length,
      content
    }
  }

  // Attachments too big to return through the API (6 MB Lambda response cap)
  // are copied out of the MIME to their own S3 object and handed to the browser
  // as a presigned URL, so the bytes never pass through API Gateway. The copy
  // is short-lived; the bucket lifecycle expires the `attachments/` prefix.
  async presignAttachment({ bucket, key, filename, contentType, content }) {
    const target = bucket || this.defaultBucket
    await this.client.send(
      new PutObjectCommand({
        Bucket: target,
        Key: key,
        Body: content,
        ContentType: contentType,
        // S3 header values must be ASCII; a Swedish filename would otherwise
        // be rejected outright.
        ContentDisposition: `attachment; filename="${asciiName(filename)}"`
      })
    )
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: target, Key: key }),
      { expiresIn: 900 }
    )
  }
}
