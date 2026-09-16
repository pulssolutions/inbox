import { describe, it, expect } from 'vitest'
import { notifyRecipients, notifyPref } from '../../src/notify.js'

const admin = (over = {}) => ({
  email: 'a@x.se',
  name: 'A',
  role: 'admin',
  categories: [],
  active: true,
  ...over
})

describe('notifyRecipients', () => {
  it('includes every active superadmin (all categories)', () => {
    const admins = [
      admin({ email: 'super@x.se', role: 'superadmin' }),
      admin({ email: 'other@x.se', role: 'admin', categories: ['styrelse'] })
    ]
    expect(notifyRecipients(admins, 'kurser')).toEqual(['super@x.se'])
  })

  it('includes scoped admins whose categories cover the issue', () => {
    const admins = [
      admin({ email: 'kurs@x.se', categories: ['kurser', 'medlem'] }),
      admin({ email: 'styr@x.se', categories: ['styrelse'] })
    ]
    expect(notifyRecipients(admins, 'kurser')).toEqual(['kurs@x.se'])
  })

  it('skips inactive admins', () => {
    const admins = [
      admin({ email: 'gone@x.se', role: 'superadmin', active: false }),
      admin({ email: 'kurs@x.se', categories: ['kurser'] })
    ]
    expect(notifyRecipients(admins, 'kurser')).toEqual(['kurs@x.se'])
  })

  it('dedupes by lowercased email and ignores rows without an email', () => {
    const admins = [
      admin({ email: 'Super@x.se', role: 'superadmin' }),
      admin({ email: 'super@x.se', categories: ['kurser'] }),
      admin({ email: '', role: 'superadmin' })
    ]
    expect(notifyRecipients(admins, 'kurser')).toEqual(['super@x.se'])
  })

  it('returns empty when nobody is responsible for the category', () => {
    const admins = [admin({ email: 'styr@x.se', categories: ['styrelse'] })]
    expect(notifyRecipients(admins, 'kurser')).toEqual([])
  })

  it('skips admins who opted out of new-issue mail (notifyNewIssue=false)', () => {
    const admins = [
      admin({ email: 'muted@x.se', role: 'superadmin', notifyNewIssue: false }),
      admin({ email: 'on@x.se', role: 'superadmin' }), // undefined → default on
      admin({ email: 'kurs@x.se', categories: ['kurser'], notifyNewIssue: true })
    ]
    expect(notifyRecipients(admins, 'kurser')).toEqual(['on@x.se', 'kurs@x.se'])
  })
})

describe('notifyPref', () => {
  it('defaults new-issue mail on and reply mail off', () => {
    expect(notifyPref(admin(), 'newIssue')).toBe(true)
    expect(notifyPref(admin({ notifyReply: null }), 'reply')).toBe(false)
  })

  it('falls back to the org default before the code default', () => {
    const a = admin({ notifyReply: null, notifyNewIssue: null })
    expect(notifyPref(a, 'reply', { reply: true })).toBe(true)
    expect(notifyPref(a, 'newIssue', { newIssue: false })).toBe(false)
  })

  it("lets an admin's own choice win over the org default", () => {
    const a = admin({ notifyNewIssue: false, notifyReply: true })
    expect(notifyPref(a, 'newIssue', { newIssue: true })).toBe(false)
    expect(notifyPref(a, 'reply', { reply: false })).toBe(true)
  })

  it('carries a pre-split row forward: notifyNewIssue governed reply mail too', () => {
    expect(notifyPref(admin({ notifyNewIssue: true }), 'reply', { reply: false })).toBe(true)
    expect(notifyPref(admin({ notifyNewIssue: false }), 'reply', { reply: true })).toBe(false)
    // Older still: no flag at all, which used to mean on for both events.
    expect(notifyPref(admin(), 'reply', { reply: false })).toBe(true)
  })

  it('stops carrying it forward once the row has a notifyReply of its own', () => {
    const a = admin({ notifyNewIssue: true, notifyReply: null })
    expect(notifyPref(a, 'reply', { reply: false })).toBe(false)
  })
})

describe('notifyRecipients events', () => {
  const admins = [
    admin({ email: 'legacy@x.se', role: 'superadmin', notifyNewIssue: true }),
    admin({ email: 'new@x.se', role: 'superadmin', notifyNewIssue: null, notifyReply: null }),
    admin({ email: 'replies@x.se', role: 'superadmin', notifyNewIssue: false, notifyReply: true })
  ]

  it('uses the new-issue flag for new issues', () => {
    expect(notifyRecipients(admins, 'kurser', { event: 'newIssue' })).toEqual([
      'legacy@x.se',
      'new@x.se'
    ])
  })

  it('uses the reply flag for activity on an existing issue', () => {
    expect(notifyRecipients(admins, 'kurser', { event: 'reply' })).toEqual([
      'legacy@x.se',
      'replies@x.se'
    ])
  })

  it('applies the org defaults to admins who have not chosen', () => {
    expect(
      notifyRecipients(admins, 'kurser', { event: 'reply', orgDefaults: { reply: true } })
    ).toEqual(['legacy@x.se', 'new@x.se', 'replies@x.se'])
  })
})
