import { describe, it, expect } from 'vitest'
import { buildHarness } from './helper/setup.js'

// The scheduled sweep arrives as an EventBridge event with no routeKey; without
// the branch in index.js it would fall through the router as a 404.
describe('scheduled reminder sweep through the Lambda handler', () => {
  it('runs the nag instead of routing the event', async () => {
    const { db, ses, handler } = buildHarness()
    const old = new Date(Date.now() - 30 * 3600 * 1000).toISOString()
    await db.putTenant({ domain: 'acme.example', org: 'acme', name: 'Klubben' })
    await db.putMessage({
      org: 'acme',
      message: {
        messageId: 'm1',
        category: 'kurser',
        subject: 'Fråga om kurs',
        from: 'Anna <anna@example.se>',
        receivedAt: old,
        lastActivityAt: old,
        state: 'open',
        box: 'inbox',
        direction: 'inbound'
      }
    })
    await db.putAdmin({
      org: 'acme',
      admin: { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true }
    })
    const res = await handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' })
    expect(res).toMatchObject({ notified: 1 })
    expect(ses.notifications.map((n) => n.to)).toEqual(['boss@acme.example'])
  })
})
