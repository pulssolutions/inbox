import { describe, it, expect, beforeEach } from 'vitest'
import { FakeDocClient } from '../helper/fake-doc-client.js'
import { Database } from '../../src/database.js'
import { list, create, update, remove } from '../../src/admins/admin.js'

const ORG = 'acme'
const claims = { email: 'boss@acme.example' }

const makeDeps = () => ({
  db: new Database({ docClient: new FakeDocClient(), tableName: 't' })
})

const seedSuper = (deps, email = 'boss@acme.example') =>
  deps.db.putAdmin({ org: ORG, admin: { email, name: 'Boss', role: 'superadmin', active: true } })

describe('admins CRUD', () => {
  let deps
  beforeEach(() => {
    deps = makeDeps()
  })

  it('create adds a scoped admin with categories', async () => {
    const res = await create({
      deps,
      org: ORG,
      claims,
      body: { email: 'Leader@acme.example', name: 'Leader', role: 'admin', categories: ['kurser'] }
    })
    expect(res.statusCode).toBe(201)
    expect(res.data).toMatchObject({ email: 'leader@acme.example', role: 'admin', categories: ['kurser'] })
    const log = await deps.db.listAudit({ org: ORG })
    expect(log[0]).toMatchObject({ action: 'admin.create', targetId: 'leader@acme.example' })
  })

  it('create strips categories for a superadmin', async () => {
    const res = await create({
      deps,
      org: ORG,
      claims,
      body: { email: 'b@x.se', name: 'B', role: 'superadmin', categories: ['kurser'] }
    })
    expect(res.data.categories).toEqual([])
  })

  it('rejects an invalid email / role', async () => {
    await expect(
      create({ deps, org: ORG, claims, body: { email: 'nope', name: 'X', role: 'admin' } })
    ).rejects.toMatchObject({ code: 'EMAIL_INVALID' })
    await expect(
      create({ deps, org: ORG, claims, body: { email: 'a@b.se', name: 'X', role: 'king' } })
    ).rejects.toMatchObject({ code: 'ROLE_INVALID' })
  })

  it('rejects a duplicate', async () => {
    await create({ deps, org: ORG, claims, body: { email: 'a@b.se', name: 'A', role: 'admin' } })
    await expect(
      create({ deps, org: ORG, claims, body: { email: 'a@b.se', name: 'A', role: 'admin' } })
    ).rejects.toMatchObject({ name: 'ConflictError' })
  })

  it('list returns admins', async () => {
    await seedSuper(deps)
    await create({ deps, org: ORG, claims, body: { email: 'a@b.se', name: 'A', role: 'admin', categories: [] } })
    const all = await list({ deps, org: ORG })
    expect(all).toHaveLength(2)
  })

  it('a created admin is findable by email across orgs (email GSI)', async () => {
    await create({ deps, org: 'acme', claims, body: { email: 'multi@x.se', name: 'M', role: 'admin', categories: ['kurser'] } })
    await create({ deps, org: 'hundklubben', claims, body: { email: 'multi@x.se', name: 'M', role: 'superadmin' } })
    const orgs = await deps.db.listAdminOrgsByEmail({ email: 'multi@x.se' })
    expect(orgs.map((o) => o.org).sort()).toEqual(['acme', 'hundklubben'])
  })

  it('provisions a native Cognito user when one is added', async () => {
    const created = []
    deps.cognito = { ensureNativeUser: async ({ email }) => created.push(email) }
    await create({
      deps,
      org: ORG,
      claims,
      body: { email: 'New@acme.example', name: 'New', role: 'admin' }
    })
    expect(created).toEqual(['new@acme.example'])
  })

  it('does not write the admin row if Cognito provisioning fails', async () => {
    deps.cognito = {
      ensureNativeUser: async () => {
        throw new Error('cognito down')
      }
    }
    await expect(
      create({ deps, org: ORG, claims, body: { email: 'x@b.se', name: 'X', role: 'admin' } })
    ).rejects.toThrow('cognito down')
    expect(await deps.db.getAdmin({ org: ORG, email: 'x@b.se' })).toBeNull()
  })

  it('defaults notifyNewIssue to true on create, accepts false', async () => {
    const on = await create({ deps, org: ORG, claims, body: { email: 'a@b.se', name: 'A', role: 'admin' } })
    expect(on.data.notifyNewIssue).toBe(true)
    const off = await create({ deps, org: ORG, claims, body: { email: 'c@b.se', name: 'C', role: 'admin', notifyNewIssue: false } })
    expect(off.data.notifyNewIssue).toBe(false)
  })

  it('update toggles notifyNewIssue and leaves it untouched when omitted', async () => {
    await create({ deps, org: ORG, claims, body: { email: 'a@b.se', name: 'A', role: 'admin' } })
    const off = await update({ deps, org: ORG, pathParameters: { email: 'a@b.se' }, body: { notifyNewIssue: false } })
    expect(off.notifyNewIssue).toBe(false)
    // omitting it preserves the stored value
    const same = await update({ deps, org: ORG, pathParameters: { email: 'a@b.se' }, body: { name: 'A2' } })
    expect(same.notifyNewIssue).toBe(false)
  })

  it('rejects a non-boolean notifyNewIssue', async () => {
    await expect(
      create({ deps, org: ORG, claims, body: { email: 'a@b.se', name: 'A', role: 'admin', notifyNewIssue: 'yes' } })
    ).rejects.toMatchObject({ code: 'NOTIFY_INVALID' })
  })

  it('update merges role + categories', async () => {
    await create({ deps, org: ORG, claims, body: { email: 'a@b.se', name: 'A', role: 'admin', categories: ['kurser'] } })
    const res = await update({
      deps,
      org: ORG,
      pathParameters: { email: 'a@b.se' },
      body: { categories: ['kurser', 'styrelse'] }
    })
    expect(res.categories).toEqual(['kurser', 'styrelse'])
  })

  it('remove deletes an admin', async () => {
    await seedSuper(deps)
    await create({ deps, org: ORG, claims, body: { email: 'a@b.se', name: 'A', role: 'admin' } })
    const res = await remove({ deps, org: ORG, pathParameters: { email: 'a@b.se' } })
    expect(res.statusCode).toBe(204)
    expect(await deps.db.getAdmin({ org: ORG, email: 'a@b.se' })).toBeNull()
  })

  it('refuses to delete the last superadmin', async () => {
    await seedSuper(deps)
    await expect(
      remove({ deps, org: ORG, pathParameters: { email: 'boss@acme.example' } })
    ).rejects.toMatchObject({ code: 'LAST_SUPERADMIN' })
  })

  it('refuses to demote the last superadmin', async () => {
    await seedSuper(deps)
    await expect(
      update({
        deps,
        org: ORG,
        pathParameters: { email: 'boss@acme.example' },
        body: { role: 'admin' }
      })
    ).rejects.toMatchObject({ code: 'LAST_SUPERADMIN' })
  })

  it('allows demoting a superadmin when another remains', async () => {
    await seedSuper(deps, 'boss@acme.example')
    await seedSuper(deps, 'boss2@acme.example')
    const res = await update({
      deps,
      org: ORG,
      pathParameters: { email: 'boss2@acme.example' },
      body: { role: 'admin', categories: ['kurser'] }
    })
    expect(res.role).toBe('admin')
  })
})
