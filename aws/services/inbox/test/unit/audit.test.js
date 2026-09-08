import { describe, it, expect } from 'vitest'
import { recordAudit } from '../../src/audit.js'

describe('recordAudit', () => {
  it('writes an entry with actor + action + target', async () => {
    const puts = []
    const deps = { db: { putAudit: async (e) => puts.push(e) } }
    await recordAudit(deps, {
      org: 'acme',
      claims: { email: 'boss@x.se', name: 'Boss' },
      action: 'delete',
      targetType: 'message',
      targetId: 'm1',
      targetLabel: 'Hej',
      meta: { category: 'kurser' }
    })
    expect(puts).toHaveLength(1)
    expect(puts[0]).toMatchObject({
      org: 'acme',
      entry: {
        actor: { email: 'boss@x.se', name: 'Boss' },
        action: 'delete',
        targetId: 'm1',
        targetLabel: 'Hej',
        meta: { category: 'kurser' }
      }
    })
  })

  it('is best-effort: a putAudit failure does not throw', async () => {
    const deps = { db: { putAudit: async () => { throw new Error('ddb down') } } }
    await expect(
      recordAudit(deps, { org: 'o', claims: {}, action: 'reply' })
    ).resolves.toBeUndefined()
  })
})
