import { describe, it, expect } from 'vitest'
import {
  tenantKey,
  messageKey,
  messageGsi1Pk,
  messageGsi1Sk,
  adminKey,
  domainSlug,
  splitAddress
} from '../../src/keys.js'

describe('keys', () => {
  it('tenantKey is a global ALL:tenant row keyed by lowercased domain', () => {
    expect(tenantKey('AcMe.ExAmPlE')).toEqual({
      pk: 'ALL:tenant',
      sk: 'acme.example'
    })
  })

  it('messageKey is org-scoped by messageId', () => {
    expect(messageKey('acme', 'abc123')).toEqual({
      pk: 'acme:message',
      sk: 'abc123'
    })
  })

  it('messageGsi1Pk buckets by org + mailbox', () => {
    expect(messageGsi1Pk('acme', 'inbox')).toBe(
      'acme:message:inbox'
    )
    expect(messageGsi1Pk('acme', 'archived')).toBe(
      'acme:message:archived'
    )
  })

  it('messageGsi1Sk sorts by receivedAt then messageId', () => {
    expect(messageGsi1Sk('2026-06-02T10:00:00Z', 'abc')).toBe(
      '2026-06-02T10:00:00Z#abc'
    )
  })

  it('adminKey lowercases email', () => {
    expect(adminKey('acme', 'Anna@Example.SE')).toEqual({
      pk: 'acme:admin',
      sk: 'anna@example.se'
    })
  })
})

describe('domainSlug (fallback tenant slug)', () => {
  it('lowercases and turns dots into dashes', () => {
    expect(domainSlug('NewClub.com')).toBe('newclub-com')
  })

  it('strips characters outside [a-z0-9-]', () => {
    expect(domainSlug('hund_klubb.se')).toBe('hundklubb-se')
  })

  it('collapses and trims separators', () => {
    expect(domainSlug('.a--b.')).toBe('a-b')
  })
})

describe('splitAddress', () => {
  it('parses a bare address', () => {
    expect(splitAddress('kurser@acme.example')).toEqual({
      local: 'kurser',
      domain: 'acme.example'
    })
  })

  it('parses a display-name address with angle brackets', () => {
    expect(splitAddress('Kurser Acme <Kurser@Acme.EXAMPLE>')).toEqual({
      local: 'kurser',
      domain: 'acme.example'
    })
  })

  it('returns null parts for garbage', () => {
    expect(splitAddress('not-an-email')).toEqual({
      local: null,
      domain: null
    })
  })

  it('handles empty / undefined input', () => {
    expect(splitAddress('')).toEqual({ local: null, domain: null })
    expect(splitAddress(undefined)).toEqual({ local: null, domain: null })
  })
})
