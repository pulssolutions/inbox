import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageList from '@/components/MessageList.vue'

const messages = [
  {
    messageId: 'a',
    from: 'Anna Svensson <anna@example.se>',
    subject: 'Fråga',
    category: 'kurser',
    receivedAt: '2026-06-02T09:00:00Z',
    status: 'unread'
  },
  {
    messageId: 'b',
    from: 'bjorn@example.se',
    subject: 'Möte',
    category: 'styrelse',
    receivedAt: '2026-06-01T09:00:00Z',
    status: 'read'
  }
]

describe('MessageList', () => {
  it('renders one row per message with sender name + subject', () => {
    const w = mount(MessageList, { props: { messages } })
    const items = w.findAll('.list-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('Anna Svensson')
    expect(items[0].text()).toContain('Fråga')
  })

  it('marks unread rows', () => {
    const w = mount(MessageList, { props: { messages } })
    const items = w.findAll('.list-item')
    expect(items[0].classes()).toContain('unread')
    expect(items[1].classes()).not.toContain('unread')
  })

  it('highlights the selected row', () => {
    const w = mount(MessageList, { props: { messages, selectedId: 'b' } })
    expect(w.findAll('.list-item')[1].classes()).toContain('active')
  })

  it('emits select with the messageId on click', async () => {
    const w = mount(MessageList, { props: { messages } })
    await w.findAll('.list-item')[0].trigger('click')
    expect(w.emitted('select')[0]).toEqual(['a'])
  })

  it('shows an empty state when there are no messages', () => {
    const w = mount(MessageList, { props: { messages: [], loading: false } })
    expect(w.text()).toContain('Inga meddelanden')
  })

  it('shows a spinner while loading (not the list or empty state)', () => {
    const w = mount(MessageList, { props: { messages: [], loading: true } })
    expect(w.find('[data-testid="spinner"]').exists()).toBe(true)
    expect(w.text()).not.toContain('Inga meddelanden')
  })

  it('shows the assignee initials when a message is assigned', () => {
    const w = mount(MessageList, {
      props: { messages: [{ ...messages[0], assignee: 'linn@acme.example' }] }
    })
    const av = w.find('.assignee-av')
    expect(av.exists()).toBe(true)
    expect(av.text()).toBe('LI')
    expect(av.attributes('title')).toContain('linn@acme.example')
  })

  it('shows a workflow-state badge per row', () => {
    const w = mount(MessageList, {
      props: { messages: [{ ...messages[0], state: 'pending' }] }
    })
    expect(w.find('.badge.state-pending').text()).toBe('Pågår')
  })
})
