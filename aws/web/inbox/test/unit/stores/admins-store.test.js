import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAdminsStore } from '@/stores/admins-store'

vi.mock('@/services/admins-service', () => ({
  loadAdminsAPI: vi.fn(),
  createAdminAPI: vi.fn(),
  updateAdminAPI: vi.fn(),
  deleteAdminAPI: vi.fn()
}))

import {
  loadAdminsAPI,
  createAdminAPI,
  updateAdminAPI,
  deleteAdminAPI
} from '@/services/admins-service'

describe('admins-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loadAdminsAction populates admins', async () => {
    loadAdminsAPI.mockResolvedValueOnce([{ email: 'a@b.se', role: 'admin' }])
    const s = useAdminsStore()
    await s.loadAdminsAction()
    expect(s.admins).toHaveLength(1)
  })

  it('createAdminAction appends', async () => {
    createAdminAPI.mockResolvedValueOnce({ email: 'new@b.se', role: 'admin' })
    const s = useAdminsStore()
    s.admins = [{ email: 'a@b.se' }]
    await s.createAdminAction({ email: 'new@b.se', name: 'N', role: 'admin', categories: [] })
    expect(s.admins.map((a) => a.email)).toEqual(['a@b.se', 'new@b.se'])
  })

  it('updateAdminAction replaces the matching admin', async () => {
    updateAdminAPI.mockResolvedValueOnce({ email: 'a@b.se', role: 'admin', categories: ['kurser'] })
    const s = useAdminsStore()
    s.admins = [{ email: 'a@b.se', categories: [] }]
    await s.updateAdminAction('a@b.se', { categories: ['kurser'] })
    expect(s.admins[0].categories).toEqual(['kurser'])
  })

  it('deleteAdminAction removes', async () => {
    deleteAdminAPI.mockResolvedValueOnce({ email: 'a@b.se', deleted: true })
    const s = useAdminsStore()
    s.admins = [{ email: 'a@b.se' }, { email: 'c@d.se' }]
    await s.deleteAdminAction('a@b.se')
    expect(s.admins.map((a) => a.email)).toEqual(['c@d.se'])
  })

  it('records save error (e.g. last superadmin)', async () => {
    const err = Object.assign(new Error('x'), { code: 'LAST_SUPERADMIN' })
    updateAdminAPI.mockRejectedValueOnce(err)
    const s = useAdminsStore()
    s.admins = [{ email: 'a@b.se' }]
    await expect(s.updateAdminAction('a@b.se', { role: 'admin' })).rejects.toBe(err)
    expect(s.error.save).toBe(err)
  })
})
