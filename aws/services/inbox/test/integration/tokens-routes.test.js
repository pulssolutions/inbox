import { describe, it, expect } from 'vitest'
import { apiEvent } from './helper/event.js'
import { buildHarness, parseBody } from './helper/setup.js'

const ORG = 'acme'
const superClaims = {
  email: 'boss@acme.example',
  orgs: JSON.stringify({
    [ORG]: {
      active: true,
      capabilities: { admins: { read: true, write: true } }
    }
  })
}

describe('integration: token routes', () => {
  it('creates, lists and deletes through the proxy route, gated on admins.write', async () => {
    const h = buildHarness()
    await h.db.putAdmin({
      org: ORG,
      admin: { email: 'leader@acme.example', name: 'L', role: 'admin' }
    })
    const created = await h.handler(
      apiEvent({
        method: 'POST',
        path: '/admin/tokens',
        routeTemplate: '/admin/{proxy+}',
        claims: superClaims,
        body: { name: 'bot', owner: 'leader@acme.example' }
      })
    )
    expect(created.statusCode).toBe(201)
    const { tokenId, secret } = parseBody(created)
    expect(secret).toMatch(/^inbx_/)
    const listed = await h.handler(
      apiEvent({
        method: 'GET',
        path: '/admin/tokens',
        routeTemplate: '/admin/{proxy+}',
        claims: superClaims
      })
    )
    expect(parseBody(listed)).toEqual([
      expect.objectContaining({
        tokenId,
        name: 'bot',
        owner: 'leader@acme.example'
      })
    ])
    expect(listed.body).not.toContain('hash')
    const denied = await h.handler(
      apiEvent({
        method: 'GET',
        path: '/admin/tokens',
        routeTemplate: '/admin/{proxy+}',
        claims: {
          email: 'x',
          orgs: JSON.stringify({
            [ORG]: { active: true, capabilities: { inbox: { read: true } } }
          })
        }
      })
    )
    expect(denied.statusCode).toBe(401)
    const deleted = await h.handler(
      apiEvent({
        method: 'DELETE',
        path: `/admin/tokens/${tokenId}`,
        routeTemplate: '/admin/{proxy+}',
        claims: superClaims
      })
    )
    expect(deleted.statusCode).toBe(204)
  })
})
