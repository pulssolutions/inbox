import { describe, it, expect, beforeEach } from 'vitest'
import { FakeDocClient } from '../helper/fake-doc-client.js'
import { FakeSes } from '../helper/fake-ses.js'
import { Database } from '../../src/database.js'
import { runNag } from '../../src/nag.js'

const ORG = 'acme'
const NOW = new Date('2026-08-27T05:00:00Z')
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString()

const makeDeps = () => {
  const docClient = new FakeDocClient()
  return {
    db: new Database({ docClient, tableName: 'inbox-test' }),
    ses: new FakeSes(),
    webBaseUrl: 'https://dev.inbox.apps.acme.example',
    docClient
  }
}

// An open, quiet-for-25h root in the inbox — the baseline candidate.
const openMessage = (over = {}) => ({
  messageId: 'm1',
  category: 'kurser',
  from: 'Anna <anna@example.se>',
  to: ['kurser@acme.example'],
  subject: 'Fråga om kurs',
  receivedAt: hoursAgo(25),
  lastActivityAt: hoursAgo(25),
  status: 'read',
  state: 'open',
  direction: 'inbound',
  box: 'inbox',
  ...over
})

const seed = async (deps, message, { org = ORG } = {}) => {
  await deps.db.putTenant({ domain: `${org}.se`, org, name: 'Klubben' })
  await deps.db.putMessage({ org, message })
}

describe('nag', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  it('reminds the category subscribers about an issue left open for 25h', async () => {
    await seed(deps, openMessage())
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'kurs@acme.example', name: 'Kurs', role: 'admin', active: true, categories: ['kurser'] }
    })
    const res = await runNag(deps, NOW)
    expect(res).toMatchObject({ notified: 1 })
    expect(deps.ses.notifications.map((n) => n.to)).toEqual(['kurs@acme.example'])
    const n = deps.ses.notifications[0]
    expect(n.heading).toBe('Ärendet väntar fortfarande på svar')
    expect(n.subject).toBe('Påminnelse: Fråga om kurs')
    expect(n.ctaUrl).toBe('https://dev.inbox.apps.acme.example/#/m/m1')
    const stored = await deps.db.getMessage({ org: ORG, messageId: 'm1' })
    expect(stored.nagCount).toBe(1)
    expect(stored.naggedAt).toBe(NOW.toISOString())
  })

  it('never moves lastActivityAt — that would reset its own clock', async () => {
    await seed(deps, openMessage())
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true }
    })
    await runNag(deps, NOW)
    const stored = await deps.db.getMessage({ org: ORG, messageId: 'm1' })
    expect(stored.lastActivityAt).toBe(hoursAgo(25))
  })

  it('goes to the assignee alone when the issue is assigned', async () => {
    await seed(deps, openMessage({ assignee: 'linn@acme.example' }))
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'kurs@acme.example', name: 'Kurs', role: 'admin', active: true, categories: ['kurser'] }
    })
    await runNag(deps, NOW)
    expect(deps.ses.notifications.map((n) => n.to)).toEqual(['linn@acme.example'])
  })

  it('respects the notifyNewIssue opt-out for category subscribers', async () => {
    await seed(deps, openMessage())
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true, notifyNewIssue: false }
    })
    await runNag(deps, NOW)
    expect(deps.ses.notifications).toHaveLength(0)
  })

  const skipped = {
    'quiet for only 23h': openMessage({ lastActivityAt: hoursAgo(23) }),
    'state pending': openMessage({ state: 'pending' }),
    'state done': openMessage({ state: 'done' }),
    'archived': openMessage({ box: 'archived' }),
    'already nagged 5 times': openMessage({ nagCount: 5, naggedAt: hoursAgo(24) }),
    'nagged 2h ago': openMessage({ nagCount: 1, naggedAt: hoursAgo(2) })
  }
  for (const [label, message] of Object.entries(skipped)) {
    it(`sends nothing for a message that is ${label}`, async () => {
      await seed(deps, message)
      await deps.db.putAdmin({
        org: ORG,
        admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true }
      })
      await runNag(deps, NOW)
      expect(deps.ses.notifications).toHaveLength(0)
    })
  }

  it('never nags a reply on its own', async () => {
    await seed(deps, openMessage({ state: 'done' }))
    await deps.db.putMessage({
      org: ORG,
      message: openMessage({ messageId: 'r1', threadId: 'm1', inReplyTo: 'm1', direction: 'outbound' })
    })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true }
    })
    await runNag(deps, NOW)
    expect(deps.ses.notifications).toHaveLength(0)
  })

  it('says the fifth reminder is the last one, then stops', async () => {
    await seed(deps, openMessage({ nagCount: 4, naggedAt: hoursAgo(24) }))
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true }
    })
    await runNag(deps, NOW)
    expect(deps.ses.notifications).toHaveLength(1)
    expect(deps.ses.notifications[0].paragraphs).toContain('Detta är den sista påminnelsen.')
    expect((await deps.db.getMessage({ org: ORG, messageId: 'm1' })).nagCount).toBe(5)
    // A later run finds nothing left to do.
    await runNag(deps, new Date(NOW.getTime() + 24 * 3600 * 1000))
    expect(deps.ses.notifications).toHaveLength(1)
  })

  it('restarts the count when the thread saw activity after the last reminder', async () => {
    // Nagged out (5), but someone replied afterwards → the clock and the count
    // both start over.
    await seed(
      deps,
      openMessage({ nagCount: 5, naggedAt: hoursAgo(48), lastActivityAt: hoursAgo(25) })
    )
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true }
    })
    await runNag(deps, NOW)
    expect(deps.ses.notifications).toHaveLength(1)
    expect((await deps.db.getMessage({ org: ORG, messageId: 'm1' })).nagCount).toBe(1)
  })

  it('sends only once when the job runs twice the same day', async () => {
    await seed(deps, openMessage())
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true }
    })
    await runNag(deps, NOW)
    await runNag(deps, new Date(NOW.getTime() + 60 * 1000))
    expect(deps.ses.notifications).toHaveLength(1)
  })

  it('keeps orgs apart and visits an org with two domains once', async () => {
    await seed(deps, openMessage())
    await deps.db.putTenant({ domain: 'alias.se', org: ORG, name: 'Klubben' })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true }
    })
    await seed(deps, openMessage({ messageId: 'o1' }), { org: 'other' })
    await deps.db.putAdmin({
      org: 'other',
      admin: { email: 'other@x.se', name: 'Other', role: 'superadmin', active: true }
    })
    await runNag(deps, NOW)
    expect(deps.ses.notifications.map((n) => n.to).sort()).toEqual([
      'boss@acme.example',
      'other@x.se'
    ])
  })

  it('a failing send does not stop the rest', async () => {
    await seed(deps, openMessage())
    await deps.db.putMessage({ org: ORG, message: openMessage({ messageId: 'm2' }) })
    await deps.db.putAdmin({
      org: ORG,
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true }
    })
    const real = deps.ses.sendNotification.bind(deps.ses)
    let first = true
    deps.ses.sendNotification = async (args) => {
      if (first) {
        first = false
        throw new Error('SES down')
      }
      return real(args)
    }
    const res = await runNag(deps, NOW)
    expect(res.notified).toBe(1)
    expect(deps.ses.notifications).toHaveLength(1)
  })
})
