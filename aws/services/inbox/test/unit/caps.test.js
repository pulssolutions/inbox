import { describe, it, expect } from 'vitest'
import { orgEntry } from '../../src/caps.js'
import { handler, __setDocClient } from '../../pretoken/src/index.mjs'

describe('orgEntry', () => {
  it('yields the same capability object the pretoken emits for one admin row', async () => {
    process.env.TABLE_NAME = 't'
    const row = {
      org: 'acme',
      role: 'admin',
      active: true,
      categories: ['kurser']
    }
    __setDocClient({
      async send(cmd) {
        const pk = cmd.input.ExpressionAttributeValues[':pk']
        if (cmd.input.IndexName === 'gsi1') return { Items: [row] }
        return {
          Items: pk === 'ALL:tenant' ? [{ org: 'acme', name: 'Acme BK' }] : []
        }
      }
    })
    const res = await handler({
      request: { userAttributes: { email: 'leader@acme.example' } }
    })
    const fromPretoken = JSON.parse(
      res.response.claimsOverrideDetails.claimsToAddOrOverride.orgs
    )
    expect(orgEntry(row, 'Acme BK')).toEqual(fromPretoken.acme)
    delete process.env.TABLE_NAME
    __setDocClient(null)
  })

  it('every admin may propose; replyApproval removes send for any role', () => {
    expect(orgEntry({ role: 'admin' }, 'X').capabilities.inbox).toEqual({
      read: true,
      write: true,
      send: true,
      propose: true
    })
    for (const role of ['admin', 'superadmin']) {
      expect(orgEntry({ role, replyApproval: true }, 'X').capabilities.inbox).toMatchObject({
        send: false,
        propose: true
      })
    }
  })

  it('gives a superadmin every capability and all categories', () => {
    const e = orgEntry({ role: 'superadmin' }, 'X')
    expect(e.capabilities.admins).toEqual({
      read: true,
      write: true,
      delete: true
    })
    expect(e.categories).toBe('*')
  })
})
