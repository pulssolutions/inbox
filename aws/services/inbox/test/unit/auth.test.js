import { describe, it, expect, vi, afterEach } from 'vitest'
import { allowedCategories, assertCategoryAllowed } from '../../src/auth.js'
import { NotFoundError } from '../../src/errors.js'

const ORG = 'acme'
const claims = (categories) => ({
  email: 'a@acme.example',
  orgs: JSON.stringify({ acme: { categories } })
})

afterEach(() => vi.restoreAllMocks())

describe('allowedCategories', () => {
  it('grants everything for the explicit wildcard', () => {
    expect(allowedCategories(claims('*'), ORG)).toBe('*')
  })

  it('grants everything when the org entry carries no categories at all', () => {
    // An unscoped admin: the pretoken trigger omits the key rather than
    // writing '*'. Absent has always meant superadmin and still does.
    const noKey = { orgs: JSON.stringify({ acme: { name: 'Acme' } }) }
    expect(allowedCategories(noKey, ORG)).toBe('*')
    expect(allowedCategories(claims(null), ORG)).toBe('*')
  })

  it('returns the array it was given', () => {
    expect(allowedCategories(claims(['kurser', 'support']), ORG)).toEqual(['kurser', 'support'])
  })

  it('parses an array delivered as a JSON string', () => {
    const asString = { orgs: JSON.stringify({ acme: { categories: '["kurser"]' } }) }
    expect(allowedCategories(asString, ORG)).toEqual(['kurser'])
  })

  // The point of the fix. Every one of these used to return '*' - a scoped
  // admin silently promoted to every category in the org, with nothing to
  // notice it by.
  it.each([
    ['a bare string that is not JSON', 'kurser'],
    ['JSON that is an object, not an array', '{"kurser":true}'],
    ['JSON that is a number', '7'],
    ['a number', 7],
    ['a boolean', true],
    ['an object', { kurser: true }]
  ])('denies everything for %s', (_label, categories) => {
    expect(allowedCategories(claims(categories), ORG)).toEqual([])
  })

  it('warns when it rejects a value, so a pretoken regression is visible', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    allowedCategories(claims('kurser'), ORG)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0].join(' ')).toMatch(/categories/i)
  })

  it('does not warn on any of the valid shapes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    allowedCategories(claims('*'), ORG)
    allowedCategories(claims(['kurser']), ORG)
    allowedCategories(claims(null), ORG)
    expect(warn).not.toHaveBeenCalled()
  })

  it('leaves an org missing from the claim to requireAdmin, which runs first', () => {
    // No handler reaches this with an org the token has no entry for -
    // requireAdmin and requireCapability both reject that before it is called.
    expect(allowedCategories(claims('*'), 'other-org')).toBe('*')
  })
})

describe('assertCategoryAllowed', () => {
  it('lets a scoped admin through for a category they hold', () => {
    expect(() => assertCategoryAllowed(claims(['kurser']), ORG, 'kurser')).not.toThrow()
  })

  it('hides a category a scoped admin does not hold', () => {
    expect(() => assertCategoryAllowed(claims(['kurser']), ORG, 'lon')).toThrow(NotFoundError)
  })

  it('hides every category when the claim is malformed', () => {
    // Fails closed: an unreadable claim must not become full access.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => assertCategoryAllowed(claims('kurser'), ORG, 'kurser')).toThrow(NotFoundError)
  })
})
