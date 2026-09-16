import { describe, it, expect, beforeEach } from 'vitest'
import { FakeDocClient } from '../helper/fake-doc-client.js'
import { Database } from '../../src/database.js'
import { get, update } from '../../src/settings/admin.js'

const ORG = 'acme'
const claims = { email: 'boss@acme.example' }

describe('org notification defaults', () => {
  let deps
  beforeEach(() => {
    deps = { db: new Database({ docClient: new FakeDocClient(), tableName: 't' }) }
  })

  it('reports the code defaults for an org that has never set any', async () => {
    expect(await get({ deps, org: ORG })).toEqual({
      notifyDefaults: { newIssue: true, reply: false }
    })
  })

  it('stores a changed default and reads it back', async () => {
    const saved = await update({
      deps,
      org: ORG,
      claims,
      body: { notifyDefaults: { reply: true } }
    })
    expect(saved).toEqual({ notifyDefaults: { newIssue: true, reply: true } })
    expect(await get({ deps, org: ORG })).toEqual({
      notifyDefaults: { newIssue: true, reply: true }
    })
  })

  it('keeps each org separate', async () => {
    await update({ deps, org: ORG, claims, body: { notifyDefaults: { reply: true } } })
    expect(await get({ deps, org: 'other' })).toEqual({
      notifyDefaults: { newIssue: true, reply: false }
    })
  })

  it('does not lose a concurrent change to the other flag', async () => {
    // Two superadmins on the page at once, each toggling a different default.
    // A read-then-write-the-whole-row PATCH loses whichever landed first.
    await Promise.all([
      update({ deps, org: ORG, claims, body: { notifyDefaults: { reply: true } } }),
      update({ deps, org: ORG, claims, body: { notifyDefaults: { newIssue: false } } })
    ])
    expect(await get({ deps, org: ORG })).toEqual({
      notifyDefaults: { newIssue: false, reply: true }
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
})
