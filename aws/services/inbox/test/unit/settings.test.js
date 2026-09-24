import { describe, it, expect, beforeEach } from 'vitest'
import { FakeDocClient } from '../helper/fake-doc-client.js'
import { Database } from '../../src/database.js'
import { get, update, test as testWebhook } from '../../src/settings/admin.js'
import { WEBHOOK_DEFAULTS } from '../../src/settings/groups.js'

const ORG = 'acme'
const claims = { email: 'boss@acme.example' }

describe('org notification defaults', () => {
  let deps
  beforeEach(() => {
    deps = { db: new Database({ docClient: new FakeDocClient(), tableName: 't' }) }
  })

  it('reports the code defaults for an org that has never set any', async () => {
    expect((await get({ deps, org: ORG })).notifyDefaults).toEqual({
      newIssue: true,
      reply: false
    })
  })

  it('stores a changed default and reads it back', async () => {
    const saved = await update({
      deps,
      org: ORG,
      claims,
      body: { notifyDefaults: { reply: true } }
    })
    expect(saved.notifyDefaults).toEqual({ newIssue: true, reply: true })
    expect((await get({ deps, org: ORG })).notifyDefaults).toEqual({
      newIssue: true,
      reply: true
    })
  })

  it('keeps each org separate', async () => {
    await update({ deps, org: ORG, claims, body: { notifyDefaults: { reply: true } } })
    expect((await get({ deps, org: 'other' })).notifyDefaults).toEqual({
      newIssue: true,
      reply: false
    })
  })

  it('does not lose a concurrent change to the other flag', async () => {
    // Two superadmins on the page at once, each toggling a different default.
    // A read-then-write-the-whole-row PATCH loses whichever landed first.
    await Promise.all([
      update({ deps, org: ORG, claims, body: { notifyDefaults: { reply: true } } }),
      update({ deps, org: ORG, claims, body: { notifyDefaults: { newIssue: false } } })
    ])
    expect((await get({ deps, org: ORG })).notifyDefaults).toEqual({
      newIssue: false,
      reply: true
    })
  })

  it('audits the change', async () => {
    await update({ deps, org: ORG, claims, body: { notifyDefaults: { reply: true } } })
    const log = await deps.db.listAudit({ org: ORG })
    expect(log[0]).toMatchObject({
      action: 'settings.update',
      meta: { notifyDefaults: { newIssue: true, reply: true } }
    })
  })

  it('rejects a non-boolean default and an unknown event', async () => {
    await expect(
      update({ deps, org: ORG, claims, body: { notifyDefaults: { reply: 'yes' } } })
    ).rejects.toMatchObject({ code: 'NOTIFY_INVALID' })
    await expect(
      update({ deps, org: ORG, claims, body: { notifyDefaults: { whatever: true } } })
    ).rejects.toMatchObject({ code: 'NOTIFY_INVALID' })
    // Inherited Object.prototype keys are not events either.
    await expect(
      update({ deps, org: ORG, claims, body: { notifyDefaults: { constructor: true } } })
    ).rejects.toMatchObject({ code: 'NOTIFY_INVALID' })
  })

  it('rejects an empty notifyDefaults rather than building an empty update', async () => {
    // DynamoDB answers "Invalid UpdateExpression ... near: SET" to an update
    // that sets nothing, which surfaced as a 500 for a malformed request. The
    // fake accepts it, so only this guard catches it.
    await expect(
      update({ deps, org: ORG, claims, body: { notifyDefaults: {} } })
    ).rejects.toMatchObject({ code: 'NOTIFY_INVALID' })
  })
})

describe('webhook settings', () => {
  let deps
  let posts
  beforeEach(() => {
    posts = []
    deps = {
      db: new Database({ docClient: new FakeDocClient(), tableName: 't' }),
      mailStore: { fetchAndParse: async () => ({ text: '' }) },
      webhook: { post: async (args) => (posts.push(args), { ok: true, status: 201 }) },
      webBaseUrl: 'https://inbox.example'
    }
  })

  const URL = 'https://3.basecamp.com/1/integrations/tok/lines'
  const save = (webhook) => update({ deps, org: ORG, claims, body: { webhook } })

  it('reports the shipped defaults, and off, for an org that has set nothing', async () => {
    const { webhook } = await get({ deps, org: ORG })
    expect(webhook).toEqual({ ...WEBHOOK_DEFAULTS, enabled: false })
  })

  it('reports the deployment flag rather than anything stored', async () => {
    deps.webhookEnabled = true
    expect((await get({ deps, org: ORG })).webhook.enabled).toBe(true)
    // Not something an org can grant itself by writing the row.
    await save({ url: URL, enabled: true })
    deps.webhookEnabled = false
    expect((await get({ deps, org: ORG })).webhook.enabled).toBe(false)
  })

  it('stores a partial change and leaves the other fields alone', async () => {
    await save({ url: URL })
    const { webhook } = await save({ onReply: false })
    expect(webhook.url).toBe(URL)
    expect(webhook.onReply).toBe(false)
    expect(webhook.template).toBe(WEBHOOK_DEFAULTS.template)
  })

  it('answers with every group, so the client cannot drift', async () => {
    const saved = await save({ url: URL })
    expect(saved.notifyDefaults).toEqual({ newIssue: true, reply: false })
  })

  it('keeps the shared secret out of the audit log', async () => {
    await save({ url: URL, token: 'sup3rsecret' })
    const log = await deps.db.listAudit({ org: ORG })
    expect(JSON.stringify(log)).not.toContain('sup3rsecret')
    expect(log[0].meta.webhook.token).toBe('***')
  })

  it('refuses a url that is not https, and a private address', async () => {
    await expect(save({ url: 'http://example.com/h' })).rejects.toMatchObject({
      code: 'WEBHOOK_INVALID'
    })
    await expect(save({ url: 'https://169.254.169.254/h' })).rejects.toMatchObject({
      code: 'WEBHOOK_INVALID'
    })
  })

  it('accepts an empty url as the way to turn the webhook off', async () => {
    await save({ url: URL })
    const { webhook } = await save({ url: '' })
    expect(webhook.url).toBe('')
  })

  it('refuses a template with a placeholder that does not exist', async () => {
    await expect(save({ template: '{{subject}} {{sbject}}' })).rejects.toMatchObject({
      code: 'WEBHOOK_INVALID'
    })
  })

  it('refuses an envelope with nowhere to put the content', async () => {
    await expect(save({ envelope: '{"content":"fixed"}' })).rejects.toMatchObject({
      code: 'WEBHOOK_INVALID'
    })
  })

  it('refuses an unknown field and a wrongly typed one', async () => {
    await expect(save({ whatever: 'x' })).rejects.toMatchObject({ code: 'WEBHOOK_INVALID' })
    await expect(save({ onReply: 'yes' })).rejects.toMatchObject({ code: 'WEBHOOK_INVALID' })
  })

  it('refuses a body naming no group at all', async () => {
    await expect(update({ deps, org: ORG, claims, body: { nonsense: {} } })).rejects.toMatchObject({
      code: 'SETTINGS_EMPTY'
    })
  })

  it('posts a sample message on test, and refuses before a url is set', async () => {
    await expect(testWebhook({ deps, org: ORG })).rejects.toMatchObject({
      code: 'WEBHOOK_NO_URL'
    })
    await save({ url: URL })
    const res = await testWebhook({ deps, org: ORG })
    expect(res).toEqual({ delivered: true, status: 201, error: null })
    expect(JSON.parse(posts[0].body).content).toContain('Testmeddelande')
  })

  it('reports a rejecting receiver on test rather than pretending it worked', async () => {
    deps.webhook.post = async () => ({ ok: false, status: 404 })
    await save({ url: URL })
    expect(await testWebhook({ deps, org: ORG })).toMatchObject({
      delivered: false,
      status: 404
    })
  })
})
