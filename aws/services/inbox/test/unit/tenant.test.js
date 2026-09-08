import { describe, it, expect, beforeEach } from 'vitest'
import { FakeDocClient } from '../helper/fake-doc-client.js'
import { Database } from '../../src/database.js'
import { resolveTenant } from '../../src/tenant.js'

const TABLE = 'inbox-test'

describe('resolveTenant', () => {
  let db
  beforeEach(() => {
    db = new Database({ docClient: new FakeDocClient(), tableName: TABLE })
  })

  it('returns the org from a matching ALL:tenant row', async () => {
    await db.putTenant({ domain: 'acme.example', org: 'acme', name: 'Acme BK' })
    expect(await resolveTenant('acme.example', db)).toBe('acme')
  })

  it('matches domain case-insensitively', async () => {
    await db.putTenant({ domain: 'acme.example', org: 'acme' })
    expect(await resolveTenant('AcMe.ExAmPlE', db)).toBe('acme')
  })

  it('falls back to a domain slug when no tenant row exists', async () => {
    expect(await resolveTenant('newclub.com', db)).toBe('newclub-com')
  })

  it('returns null for an unusable domain', async () => {
    expect(await resolveTenant('', db)).toBeNull()
    expect(await resolveTenant(undefined, db)).toBeNull()
  })
})
