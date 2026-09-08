import { describe, it, expect, beforeEach } from 'vitest'
import { apiEvent, adminClaims } from './helper/event.js'
import { buildHarness, parseBody } from './helper/setup.js'

const ORG = 'acme'

const seedMessage = (h, org, overrides = {}) =>
  h.db.putMessage({
    org,
    message: {
      messageId: 'm1',
      category: 'kurser',
      from: 'Anna <anna@example.se>',
      to: ['kurser@acme.example'],
      subject: 'Fraga om kurs',
      receivedAt: '2026-06-01T10:00:00Z',
      status: 'unread',
      direction: 'inbound',
      box: 'inbox',
      s3Bucket: 'inbox-bucket',
      s3Key: 'inbound/m1',
      ...overrides
    }
  })

describe('integration: admin messages', () => {
  let h
  beforeEach(() => {
    h = buildHarness()
  })

  it('downloads an attachment through the real proxy route', async () => {
    await seedMessage(h, ORG)
    h.mailStore.seed({
      bucket: 'inbox-bucket',
      key: 'inbound/m1',
      parsed: {
        text: 'Se bifogad fil',
        html: null,
        attachments: [
          { filename: 'offert.pdf', contentType: 'application/pdf', content: '%PDF-1.4 stub' }
        ]
      }
    })
    const claims = adminClaims(ORG)

    // The reader learns the index from the thread it just rendered.
    const detailRes = await h.handler(
      apiEvent({
        method: 'GET',
        path: '/admin/messages/m1',
        routeTemplate: '/admin/messages/{messageId}',
        claims
      })
    )
    expect(parseBody(detailRes).thread[0].attachments[0].filename).toBe('offert.pdf')

    // API Gateway sends everything as GET /admin/{proxy+}; the app has to route
    // the two-parameter path itself without shadowing GET /admin/messages/{id}.
    const res = await h.handler(
      apiEvent({
        method: 'GET',
        path: '/admin/messages/m1/attachments/0',
        routeTemplate: '/admin/{proxy+}',
        claims
      })
    )
    expect(res.statusCode).toBe(200)
    const out = parseBody(res)
    expect(out.filename).toBe('offert.pdf')
    expect(out.contentType).toBe('application/pdf')
    expect(Buffer.from(out.contentBase64, 'base64').toString('utf8')).toBe('%PDF-1.4 stub')
  })

  it('refuses an attachment download without the inbox.read capability', async () => {
    await seedMessage(h, ORG)
    const claims = adminClaims(ORG, { read: false, write: true, send: true })
    const res = await h.handler(
      apiEvent({
        method: 'GET',
        path: '/admin/messages/m1/attachments/0',
        routeTemplate: '/admin/{proxy+}',
        claims
      })
    )
    expect(res.statusCode).toBe(401)
  })

  it('rejects unauthenticated requests with 401', async () => {
    const res = await h.handler(apiEvent({ method: 'GET', path: '/admin/messages' }))
    expect(res.statusCode).toBe(401)
  })

  it('rejects a token lacking the inbox.read capability', async () => {
    await seedMessage(h, ORG)
    const claims = adminClaims(ORG, { read: false, write: true, send: true })
    const res = await h.handler(apiEvent({ method: 'GET', path: '/admin/messages', claims }))
    expect(res.statusCode).toBe(401)
    expect(parseBody(res).code).toBe('NO_CAP')
  })

  it('lists, reads (marks read), archives, and replies end-to-end', async () => {
    await seedMessage(h, ORG)
    h.mailStore.seed({
      bucket: 'inbox-bucket',
      key: 'inbound/m1',
      parsed: { text: 'Hej!', html: null, attachments: [] }
    })
    const claims = adminClaims(ORG)

    const listRes = await h.handler(apiEvent({ method: 'GET', path: '/admin/messages', claims }))
    expect(listRes.statusCode).toBe(200)
    expect(parseBody(listRes)).toHaveLength(1)

    const detailRes = await h.handler(
      apiEvent({
        method: 'GET',
        path: '/admin/messages/m1',
        routeTemplate: '/admin/messages/{messageId}',
        claims
      })
    )
    expect(detailRes.statusCode).toBe(200)
    expect(parseBody(detailRes).thread[0].text).toBe('Hej!')
    expect(parseBody(detailRes).status).toBe('read')

    const archiveRes = await h.handler(
      apiEvent({
        method: 'PATCH',
        path: '/admin/messages/m1',
        routeTemplate: '/admin/messages/{messageId}',
        body: { box: 'archived' },
        claims
      })
    )
    expect(archiveRes.statusCode).toBe(200)
    const afterArchive = await h.handler(apiEvent({ method: 'GET', path: '/admin/messages', claims }))
    expect(parseBody(afterArchive)).toHaveLength(0)

    const replyRes = await h.handler(
      apiEvent({
        method: 'POST',
        path: '/admin/messages/m1/reply',
        routeTemplate: '/admin/messages/{messageId}/reply',
        body: { body: 'Tack!' },
        claims
      })
    )
    expect(replyRes.statusCode).toBe(201)
    expect(h.ses.replies).toHaveLength(1)
    expect(h.ses.replies[0].to).toBe('Anna <anna@example.se>')
  })

  it('enforces cross-tenant isolation (org A cannot read org B message)', async () => {
    await seedMessage(h, 'orgB')
    const claimsA = adminClaims('orgA')
    const res = await h.handler(
      apiEvent({
        method: 'GET',
        path: '/admin/messages/m1',
        routeTemplate: '/admin/messages/{messageId}',
        claims: claimsA
      })
    )
    expect(res.statusCode).toBe(404)
  })

  it('audit log: superadmin can read it, a regular admin cannot', async () => {
    await h.db.putAudit({ org: ORG, entry: { action: 'reply', targetId: 'm1' } })
    const superClaims = {
      orgs: JSON.stringify({
        [ORG]: {
          active: true,
          capabilities: { inbox: { read: true }, audit: { read: true } }
        }
      })
    }
    const ok = await h.handler(apiEvent({ method: 'GET', path: '/admin/audit', claims: superClaims }))
    expect(ok.statusCode).toBe(200)
    expect(parseBody(ok)).toHaveLength(1)

    const denied = await h.handler(apiEvent({ method: 'GET', path: '/admin/audit', claims: adminClaims(ORG) }))
    expect(denied.statusCode).toBe(401)
  })

  it('returns CORS headers on every response', async () => {
    const res = await h.handler(apiEvent({ method: 'GET', path: '/admin/messages', claims: adminClaims(ORG) }))
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('routes proxy-style admin events to the concrete handler', async () => {
    await seedMessage(h, ORG)
    const claims = adminClaims(ORG)
    const ev = apiEvent({
      method: 'GET',
      path: '/admin/messages',
      claims
    })
    // Simulate API Gateway {proxy+} routing.
    ev.routeKey = 'GET /admin/{proxy+}'
    ev.requestContext.http = { method: 'GET' }
    const res = await h.handler(ev)
    expect(res.statusCode).toBe(200)
    expect(parseBody(res)).toHaveLength(1)
  })
})
