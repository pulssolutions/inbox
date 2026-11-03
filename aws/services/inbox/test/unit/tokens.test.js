import { describe, it, expect, beforeEach } from 'vitest'
import { FakeDocClient } from '../helper/fake-doc-client.js'
import { Database } from '../../src/database.js'
import { list, create, remove, resolveToken } from '../../src/tokens/admin.js'

const ORG = 'acme'
const claims = { email: 'boss@acme.example', name: 'Boss' }

const seedAdmin = (deps, admin) =>
  deps.db.putAdmin({
    org: ORG,
    admin: { role: 'admin', categories: ['kurser'], ...admin }
  })

describe('API tokens', () => {
  let deps
  beforeEach(async () => {
    deps = {
      db: new Database({ docClient: new FakeDocClient(), tableName: 't' })
    }
    await deps.db.putTenant({
      domain: 'acme.example',
      org: ORG,
      name: 'Acme BK'
    })
    await seedAdmin(deps, { email: 'leader@acme.example', name: 'Leader' })
  })

  it('creates a token for an active admin and returns the secret once', async () => {
    const res = await create({
      deps,
      org: ORG,
      claims,
      body: { name: 'bot', owner: 'Leader@acme.example' }
    })
    expect(res.statusCode).toBe(201)
    expect(res.data.secret).toMatch(/^inbx_[A-Za-z0-9_-]{43}$/)
    expect(res.data).toMatchObject({
      name: 'bot',
      owner: 'leader@acme.example'
    })
    const rows = await list({ deps, org: ORG })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      tokenId: res.data.tokenId,
      name: 'bot',
      createdBy: 'boss@acme.example'
    })
    expect(rows[0]).not.toHaveProperty('hash')
    expect(rows[0]).not.toHaveProperty('secret')
    const log = await deps.db.listAudit({ org: ORG })
    expect(log[0]).toMatchObject({
      action: 'token.create',
      meta: { name: 'bot', owner: 'leader@acme.example' }
    })
    expect(JSON.stringify(log[0])).not.toContain(res.data.secret)
  })

  it('refuses an owner that is not an active admin', async () => {
    await seedAdmin(deps, {
      email: 'gone@acme.example',
      name: 'Gone',
      active: false
    })
    for (const owner of ['nobody@acme.example', 'gone@acme.example']) {
      await expect(
        create({ deps, org: ORG, claims, body: { name: 'bot', owner } })
      ).rejects.toMatchObject({ code: 'OWNER_INVALID' })
    }
    await expect(
      create({ deps, org: ORG, claims, body: { owner: 'leader@acme.example' } })
    ).rejects.toMatchObject({ code: 'NAME_REQUIRED' })
  })

  it('deletes a token and audits it', async () => {
    const { data } = await create({
      deps,
      org: ORG,
      claims,
      body: { name: 'bot', owner: 'leader@acme.example' }
    })
    const res = await remove({
      deps,
      org: ORG,
      claims,
      pathParameters: { tokenId: data.tokenId }
    })
    expect(res.statusCode).toBe(204)
    expect(await list({ deps, org: ORG })).toEqual([])
    expect((await deps.db.listAudit({ org: ORG }))[0]).toMatchObject({
      action: 'token.delete',
      targetId: data.tokenId
    })
    await expect(
      remove({ deps, org: ORG, claims, pathParameters: { tokenId: 'x' } })
    ).rejects.toMatchObject({ code: 'TOKEN_NOT_FOUND' })
  })

  describe('resolveToken', () => {
    let secret
    beforeEach(async () => {
      secret = (
        await create({
          deps,
          org: ORG,
          claims,
          body: { name: 'bot', owner: 'leader@acme.example' }
        })
      ).data.secret
    })

    it('synthesises claims from the owner admin row', async () => {
      const r = await resolveToken(deps, secret)
      expect(r.org).toBe(ORG)
      expect(r.claims).toMatchObject({
        email: 'leader@acme.example',
        name: 'bot',
        via: 'mcp'
      })
      expect(JSON.parse(r.claims.orgs)).toEqual({
        acme: {
          capabilities: { inbox: { read: true, write: true, send: true, propose: true } },
          categories: ['kurser'],
          name: 'Acme BK',
          active: true
        }
      })
      expect((await list({ deps, org: ORG }))[0].lastUsedAt).toBeTruthy()
    })

    it('is null for an unknown token, a removed owner and an inactive owner', async () => {
      expect(await resolveToken(deps, 'inbx_nope')).toBeNull()
      expect(await resolveToken(deps, undefined)).toBeNull()
      await seedAdmin(deps, {
        email: 'leader@acme.example',
        name: 'Leader',
        active: false
      })
      expect(await resolveToken(deps, secret)).toBeNull()
      await deps.db.deleteAdmin({ org: ORG, email: 'leader@acme.example' })
      expect(await resolveToken(deps, secret)).toBeNull()
    })
  })
})
