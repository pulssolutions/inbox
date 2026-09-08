import { describe, it, expect } from 'vitest'
import { resolveOrg } from '../../src/org.js'

const ev = ({ orgs, xorg }) => ({
  headers: xorg ? { 'x-org': xorg } : {},
  requestContext: { authorizer: { jwt: { claims: { orgs: JSON.stringify(orgs) } } } }
})

describe('resolveOrg (X-Org selector validated against the signed claim)', () => {
  it('uses the single org when the user belongs to one (no header needed)', () => {
    expect(resolveOrg(ev({ orgs: { acme: { active: true } } }))).toBe('acme')
  })

  it('honors X-Org when it is one of the member orgs', () => {
    const e = ev({ orgs: { a: {}, b: {} }, xorg: 'b' })
    expect(resolveOrg(e)).toBe('b')
  })

  it('ignores a forged X-Org not in the claim → null (auth then rejects)', () => {
    const e = ev({ orgs: { a: {}, b: {} }, xorg: 'evil' })
    expect(resolveOrg(e)).toBeNull()
  })

  it('multi-org with no header → null (must select)', () => {
    expect(resolveOrg(ev({ orgs: { a: {}, b: {} } }))).toBeNull()
  })

  it('no claims → null', () => {
    expect(resolveOrg({ headers: {}, requestContext: {} })).toBeNull()
  })
})
