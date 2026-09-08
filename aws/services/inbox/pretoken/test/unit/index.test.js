import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { handler, __setDocClient } from '../../src/index.mjs'

const event = (userAttributes) => ({ request: { userAttributes }, response: {} })
const claims = (res) =>
  res.response?.claimsOverrideDetails?.claimsToAddOrOverride || null

// Fake DocClient: QueryCommand on the email GSI returns admin rows; on the base
// table (pk=ALL:tenant) returns tenant rows.
const fakeDocClient = ({ adminRowsByEmailPk = {}, tenants = [] }) => ({
  async send(cmd) {
    const input = cmd.input
    const pk = input.ExpressionAttributeValues[':pk']
    if (input.IndexName === 'gsi1') {
      return { Items: adminRowsByEmailPk[pk] || [] }
    }
    if (pk === 'ALL:tenant') return { Items: tenants }
    return { Items: [] }
  }
})

describe('inbox pretoken (DB membership, multi-org)', () => {
  beforeEach(() => {
    process.env.TABLE_NAME = 'inbox-test'
  })
  afterEach(() => {
    delete process.env.TABLE_NAME
    __setDocClient(null)
  })

  it('emits a single-org claim with caps, categories and name', () => {
    __setDocClient(
      fakeDocClient({
        adminRowsByEmailPk: {
          'admin-email#leader@acme.example': [
            { org: 'acme', role: 'admin', active: true, categories: ['kurser'] }
          ]
        },
        tenants: [{ org: 'acme', name: 'Acme BK' }]
      })
    )
    return handler(event({ email: 'leader@acme.example' })).then((res) => {
      const c = claims(res)
      expect(c.organizationId).toBe('acme')
      const orgs = JSON.parse(c.orgs)
      expect(orgs.acme.capabilities.admins).toBeUndefined()
      expect(orgs.acme.categories).toEqual(['kurser'])
      expect(orgs.acme.name).toBe('Acme BK')
    })
  })

  it('superadmin gets all caps + all categories (*)', async () => {
    __setDocClient(
      fakeDocClient({
        adminRowsByEmailPk: {
          'admin-email#boss@x.se': [{ org: 'acme', role: 'superadmin', active: true }]
        },
        tenants: [{ org: 'acme', name: 'RBK' }]
      })
    )
    const c = claims(await handler(event({ email: 'boss@x.se' })))
    const orgs = JSON.parse(c.orgs)
    expect(orgs.acme.capabilities.admins).toEqual({ read: true, write: true, delete: true })
    expect(orgs.acme.capabilities.audit).toEqual({ read: true })
    expect(orgs.acme.categories).toBe('*')
  })

  it('emits a multi-org claim and no single organizationId', async () => {
    __setDocClient(
      fakeDocClient({
        adminRowsByEmailPk: {
          'admin-email#multi@x.se': [
            { org: 'acme', role: 'admin', active: true, categories: ['kurser'] },
            { org: 'hundklubben', role: 'superadmin', active: true }
          ]
        },
        tenants: [
          { org: 'acme', name: 'RBK' },
          { org: 'hundklubben', name: 'Hundklubben' }
        ]
      })
    )
    const c = claims(await handler(event({ email: 'multi@x.se' })))
    const orgs = JSON.parse(c.orgs)
    expect(Object.keys(orgs).sort()).toEqual(['acme', 'hundklubben'])
    expect(orgs.hundklubben.name).toBe('Hundklubben')
    expect(c.organizationId).toBeUndefined() // user must pick
  })

  it('skips inactive memberships', async () => {
    __setDocClient(
      fakeDocClient({
        adminRowsByEmailPk: {
          'admin-email#x@x.se': [{ org: 'acme', role: 'admin', active: false, categories: [] }]
        }
      })
    )
    expect(claims(await handler(event({ email: 'x@x.se' })))).toBeNull()
  })

  it('emits no claim for a user with no memberships', async () => {
    __setDocClient(fakeDocClient({ adminRowsByEmailPk: {} }))
    expect(claims(await handler(event({ email: 'stranger@gmail.com' })))).toBeNull()
  })

  it('emits no claim without an email', async () => {
    __setDocClient(fakeDocClient({}))
    expect(claims(await handler(event({})))).toBeNull()
  })
})
