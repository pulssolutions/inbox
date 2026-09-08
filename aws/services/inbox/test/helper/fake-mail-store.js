// In-memory stand-in for MailStore. Keyed by `${bucket}|${key}`.
export class FakeMailStore {
  constructor() {
    this.parsed = new Map()
    this.raw = new Map()
    this.presigned = []
  }

  seed({ bucket, key, parsed, raw }) {
    if (parsed !== undefined) this.parsed.set(`${bucket}|${key}`, parsed)
    if (raw !== undefined) this.raw.set(`${bucket}|${key}`, raw)
    return this
  }

  async fetchAndParse({ bucket, key }) {
    const hit = this.parsed.get(`${bucket}|${key}`)
    if (!hit) {
      const err = new Error(`FakeMailStore: no object ${bucket}/${key}`)
      err.name = 'NotFoundError'
      throw err
    }
    return hit
  }

  // Serves bytes from the seeded `parsed.attachments[index].content` (a string
  // or Buffer), mirroring MailStore: null when there's no such index.
  async fetchAttachment({ bucket, key, index }) {
    const parsed = await this.fetchAndParse({ bucket, key })
    const found = (parsed.attachments || [])[index]
    if (!found) return null
    const content = Buffer.isBuffer(found.content)
      ? found.content
      : Buffer.from(found.content ?? '', 'utf8')
    return {
      filename: found.filename ?? null,
      contentType: found.contentType || 'application/octet-stream',
      size: content.length,
      content
    }
  }

  // Records what would have been written, and hands back a stand-in URL.
  async presignAttachment({ bucket, key, filename }) {
    this.presigned.push({ bucket, key, filename })
    return `https://s3.example/${key}?sig=fake`
  }

  async fetchRaw({ bucket, key }) {
    const hit = this.raw.get(`${bucket}|${key}`)
    if (hit === undefined) {
      const err = new Error(`FakeMailStore: no raw ${bucket}/${key}`)
      err.name = 'NotFoundError'
      throw err
    }
    return Buffer.from(hit, 'utf8')
  }
}
