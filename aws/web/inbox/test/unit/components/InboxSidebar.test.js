import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import InboxSidebar from '@/components/InboxSidebar.vue'

const categories = [
  { name: 'kurser', count: 2 },
  { name: 'styrelse', count: 1 }
]

describe('InboxSidebar', () => {
  it('renders Inkorg total and category counts', () => {
    const w = mount(InboxSidebar, { props: { box: 'inbox', categories } })
    expect(w.text()).toContain('Inkorg')
    expect(w.text()).toContain('kurser')
    expect(w.text()).toContain('styrelse')
    // total = 3
    expect(w.text()).toContain('3')
  })

  it('marks Inkorg active when box is inbox with no category', () => {
    const w = mount(InboxSidebar, { props: { box: 'inbox', category: null, categories } })
    const links = w.findAll('.side-link')
    expect(links[0].classes()).toContain('active')
  })

  it('emits select-box for Arkiverade', async () => {
    const w = mount(InboxSidebar, { props: { box: 'inbox', categories } })
    const arch = w.findAll('.side-link').find((b) => b.text().includes('Arkiverade'))
    await arch.trigger('click')
    expect(w.emitted('select-box')[0]).toEqual(['archived'])
  })

  it('emits select-assignment for Mina / Ej tilldelade', async () => {
    const w = mount(InboxSidebar, { props: { box: 'inbox', categories } })
    await w.find('[data-testid="filter-mine"]').trigger('click')
    expect(w.emitted('select-assignment')[0]).toEqual(['mine'])
    await w.find('[data-testid="filter-unassigned"]').trigger('click')
    expect(w.emitted('select-assignment')[1]).toEqual(['unassigned'])
  })

  it('emits select-state from the status pills', async () => {
    const w = mount(InboxSidebar, { props: { box: 'inbox', categories } })
    await w.find('[data-testid="state-done"]').trigger('click')
    expect(w.emitted('select-state')[0]).toEqual(['done'])
  })

  it('emits select-category, toggling off when already selected', async () => {
    const w = mount(InboxSidebar, {
      props: { box: 'inbox', category: 'kurser', categories }
    })
    const catBtns = w.findAll('.side-link').filter((b) => b.text().includes('kurser'))
    await catBtns[0].trigger('click')
    expect(w.emitted('select-category')[0]).toEqual([null])
  })

  it('hides categories in the archived box', () => {
    const w = mount(InboxSidebar, { props: { box: 'archived', categories } })
    expect(w.text()).not.toContain('Kategorier')
  })
})
