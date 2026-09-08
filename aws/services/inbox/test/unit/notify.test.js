import { describe, it, expect } from 'vitest'
import { notifyRecipients } from '../../src/notify.js'

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
