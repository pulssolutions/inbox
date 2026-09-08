import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCategoriesStore } from '@/stores/categories-store'

vi.mock('@/services/inbox-service', () => ({ loadCategoriesAPI: vi.fn() }))
import { loadCategoriesAPI } from '@/services/inbox-service'

describe('categories-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
  })

  it('loads the category list', async () => {
    loadCategoriesAPI.mockResolvedValue(['agility', 'kurser'])
    const store = useCategoriesStore()
    await store.loadCategoriesAction()
    expect(store.list).toEqual(['agility', 'kurser'])
    expect(store.loaded).toBe(true)
  })

  it('leaves the list empty when the call fails', async () => {
    loadCategoriesAPI.mockRejectedValue(new Error('nope'))
    const store = useCategoriesStore()
    await store.loadCategoriesAction()
    expect(store.list).toEqual([])
  })
})
