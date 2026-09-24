import { describe, it, expect, beforeEach } from 'vitest'
import { FakeDocClient } from '../helper/fake-doc-client.js'
import { FakeMailStore } from '../helper/fake-mail-store.js'
import { Database } from '../../src/database.js'
import { handleStream } from '../../src/stream.js'
import { update as saveSettings } from '../../src/settings/admin.js'

const ORG = 'acme'
const URL = 'https://3.basecamp.com/1/integrations/tok/lines'
const claims = { email: 'boss@acme.example' }

// Collects what was posted, and can be told to fail like an unreachable
// receiver.
class FakeWebhook {
  constructor() {
    this.posts = []
    this.fail = null
  }

  async post(args) {
    this.posts.push(args)
    if (this.fail === 'throw') throw new Error('connect ECONNREFUSED')
    if (this.fail === 'status') return { ok: false, status: 500 }
    return { ok: true, status: 201 }
  }
}

const row = (over = {}) => ({
  pk: `${ORG}:message`,
  sk: 'm1',
  messageId: 'm1',
  threadId: 'm1',
  direction: 'inbound',
  box: 'inbox',
  category: 'kurser',
  from: "'Anna' via Info <info@puls-solutions.se>",
  subject: 'Fel på mitt konto',
  receivedAt: '2026-09-24T08:00:00Z',
  s3Bucket: 'mail',
  s3Key: 'inbound/m1',
  ...over
})

// DynamoDB's wire shape, as the stream delivers it. Written out here rather
// than imported, so the test exercises the same string-only reading the consumer
// does instead of a library's richer one.
const image = (item) =>
  Object.fromEntries(Object.entries(item).map(([k, v]) => [k, { S: v }]))

const insert = (item, eventID = 'e1') => ({
  eventID,
  eventName: 'INSERT',
  eventSource: 'aws:dynamodb',
  dynamodb: { NewImage: image(item) }
})

describe('handleStream', () => {
  let deps
  let webhook

  beforeEach(async () => {
    webhook = new FakeWebhook()
    deps = {
      db: new Database({ docClient: new FakeDocClient(), tableName: 't' }),
      mailStore: new FakeMailStore(),
      webhook,
      webhookEnabled: true,
      webBaseUrl: 'https://inbox.example'
    }
    deps.mailStore.seed({
      bucket: 'mail',
      key: 'inbound/m1',
      parsed: { text: 'Hej!', html: null, attachments: [], replyTo: 'Anna <anna@taby.se>' }
    })
    await saveSettings({ deps, org: ORG, claims, body: { webhook: { url: URL } } })
  })

  it('posts a new inbound thread, rendered and addressed to the configured url', async () => {
    const res = await handleStream(deps, { Records: [insert(row())] })
    expect(res.batchItemFailures).toEqual([])
    expect(webhook.posts).toHaveLength(1)
    expect(webhook.posts[0].url).toBe(URL)
    const { content } = JSON.parse(webhook.posts[0].body)
    expect(content).toContain('Fel på mitt konto')
    expect(content).toContain('https://inbox.example/#/m/m1')
    expect(content).toContain('Hej!')
  })

  it('names the human, not the mailing list that rewrote From', async () => {
    // Google Groups replaces From: with the list address for any sender whose
    // domain publishes DMARC. Crediting the list would name it on every mail.
    await handleStream(deps, { Records: [insert(row())] })
    const { content } = JSON.parse(webhook.posts[0].body)
    expect(content).toContain('anna@taby.se')
    expect(content).not.toContain('info@puls-solutions.se')
  })

  it('posts a reply only when replies are subscribed', async () => {
    const reply = row({ messageId: 'm2', sk: 'm2', threadId: 'm1', s3Key: 'inbound/m1' })
    await saveSettings({ deps, org: ORG, claims, body: { webhook: { onReply: false } } })
    await handleStream(deps, { Records: [insert(reply)] })
    expect(webhook.posts).toHaveLength(0)

    await saveSettings({ deps, org: ORG, claims, body: { webhook: { onReply: true } } })
    await handleStream(deps, { Records: [insert(reply)] })
    expect(webhook.posts).toHaveLength(1)
  })

  it('posts a new thread only when new issues are subscribed', async () => {
    await saveSettings({ deps, org: ORG, claims, body: { webhook: { onNewIssue: false } } })
    await handleStream(deps, { Records: [insert(row())] })
    expect(webhook.posts).toHaveLength(0)
  })

  it('never announces spam or our own outbound replies', async () => {
    await handleStream(deps, {
      Records: [
        insert(row({ box: 'spam' }), 'e1'),
        insert(row({ direction: 'outbound' }), 'e2')
      ]
    })
    expect(webhook.posts).toHaveLength(0)
  })

  it('ignores rows that are not messages, and non-INSERT events', async () => {
    const note = { pk: `${ORG}:note`, sk: 'm1#t', direction: 'inbound' }
    await handleStream(deps, {
      Records: [insert(note, 'e1'), { ...insert(row(), 'e2'), eventName: 'MODIFY' }]
    })
    expect(webhook.posts).toHaveLength(0)
  })

  it('posts nothing and does not throw when no url is configured', async () => {
    await saveSettings({ deps, org: 'other', claims, body: { webhook: { onReply: true } } })
    const res = await handleStream(deps, {
      Records: [insert(row({ pk: 'other:message' }))]
    })
    expect(webhook.posts).toHaveLength(0)
    expect(res.batchItemFailures).toEqual([])
  })

  it('still announces when the stored MIME cannot be read', async () => {
    await handleStream(deps, { Records: [insert(row({ s3Key: 'inbound/gone' }))] })
    const { content } = JSON.parse(webhook.posts[0].body)
    expect(content).toContain('Fel på mitt konto')
    expect(content).toContain('https://inbox.example/#/m/m1')
  })

  it('fails only the record whose post failed, so successes are not re-posted', async () => {
    const records = [insert(row(), 'ok-1'), insert(row({ messageId: 'm2', sk: 'm2', threadId: 'm2' }), 'bad-1')]
    let n = 0
    webhook.post = async () => {
      n += 1
      if (n === 2) throw new Error('connect ECONNREFUSED')
      return { ok: true, status: 201 }
    }
    const res = await handleStream(deps, { Records: records })
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'bad-1' }])
  })

  it('treats a rejecting receiver as a failure worth retrying', async () => {
    webhook.fail = 'status'
    const res = await handleStream(deps, { Records: [insert(row())] })
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'e1' }])
  })

  it('keeps one org out of another org row', async () => {
    const res = await handleStream(deps, { Records: [insert(row({ pk: 'other:message' }))] })
    expect(webhook.posts).toHaveLength(0)
    expect(res.batchItemFailures).toEqual([])
  })
})
