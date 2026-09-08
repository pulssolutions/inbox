import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageReader from '@/components/MessageReader.vue'

const threadMsg = (over = {}) => ({
  messageId: 'a',
  direction: 'inbound',
  from: 'Anna Svensson <anna@example.se>',
  subject: 'Fråga om kurs',
  receivedAt: '2026-06-02T09:00:00Z',
  text: 'Hej! När börjar kursen?',
  html: null,
  attachments: [],
  ...over
})

const message = (over = {}) => ({
  messageId: 'a',
  from: 'Anna Svensson <anna@example.se>',
  subject: 'Fråga om kurs',
  category: 'kurser',
  receivedAt: '2026-06-02T09:00:00Z',
  state: 'open',
  direction: 'inbound',
  box: 'inbox',
  thread: [threadMsg()],
  notes: [],
  ...over
})

describe('MessageReader', () => {
  it('shows an empty state when no message is selected', () => {
    const w = mount(MessageReader, { props: { message: null } })
    expect(w.text()).toContain('Inget meddelande valt')
  })

  it('shows a spinner while loading detail', () => {
    const w = mount(MessageReader, { props: { message: null, loading: true } })
    expect(w.find('[data-testid="spinner"]').exists()).toBe(true)
    expect(w.text()).not.toContain('Inget meddelande valt')
  })

  it('renders subject, sender and the thread body', () => {
    const w = mount(MessageReader, { props: { message: message() } })
    expect(w.text()).toContain('Fråga om kurs')
    expect(w.text()).toContain('Anna Svensson')
    expect(w.text()).toContain('När börjar kursen?')
  })

  it('shows the sender email address next to the name', () => {
    const w = mount(MessageReader, { props: { message: message() } })
    const el = w.find('[data-testid="from-email"]')
    expect(el.exists()).toBe(true)
    expect(el.text()).toContain('anna@example.se')
  })

  it('renders the whole thread (inbound + outbound bubbles)', () => {
    const w = mount(MessageReader, {
      props: {
        message: message({
          thread: [
            threadMsg(),
            threadMsg({ messageId: 'r1', direction: 'outbound', from: 'support@acme.example', text: 'Vårt svar' })
          ]
        })
      }
    })
    const msgs = w.findAll('[data-testid="thread-msg"]')
    expect(msgs).toHaveLength(2)
    expect(msgs[1].classes()).toContain('outbound')
    expect(msgs[1].text()).toContain('Vårt svar')
    expect(msgs[1].text()).toContain('Skickat svar')
  })

  it('shows which admin sent an outbound reply', () => {
    const w = mount(MessageReader, {
      props: {
        message: message({
          thread: [
            threadMsg(),
            threadMsg({
              messageId: 'r1',
              direction: 'outbound',
              from: 'Acme BK - Styrelsen <styrelsen@acme.example>',
              sentByName: 'Patricia Gullberg',
              text: 'Vårt svar'
            })
          ]
        })
      }
    })
    expect(w.find('[data-testid="sent-by"]').text()).toContain('Patricia Gullberg')
  })

  it('shows the note author name, falling back to email', () => {
    const named = mount(MessageReader, {
      props: {
        message: message({
          notes: [{ author: 'p@acme.example', authorName: 'Patricia Gullberg', text: 'klart', createdAt: '2026-06-02T10:00:00Z' }]
        })
      }
    })
    expect(named.find('[data-testid="note"]').text()).toContain('Patricia Gullberg')

    const bare = mount(MessageReader, {
      props: {
        message: message({
          notes: [{ author: 'ghost@acme.example', text: 'hm', createdAt: '2026-06-02T10:00:00Z' }]
        })
      }
    })
    expect(bare.find('[data-testid="note"]').text()).toContain('ghost@acme.example')
  })

  it('emits archive / back', async () => {
    const w = mount(MessageReader, { props: { message: message() } })
    await w.find('[data-testid="archive"]').trigger('click')
    expect(w.emitted('archive')[0]).toEqual(['a'])
    await w.find('[data-testid="back"]').trigger('click')
    expect(w.emitted('back')).toBeTruthy()
  })

  it('shows delete + unarchive (not archive) for archived messages and emits them', async () => {
    const w = mount(MessageReader, { props: { message: message({ box: 'archived' }) } })
    expect(w.find('[data-testid="archive"]').exists()).toBe(false)
    const un = w.find('[data-testid="unarchive"]')
    expect(un.exists()).toBe(true)
    await un.trigger('click')
    expect(w.emitted('unarchive')[0]).toEqual(['a'])
    const del = w.find('[data-testid="delete"]')
    expect(del.exists()).toBe(true)
    await del.trigger('click')
    expect(w.emitted('delete')[0]).toEqual(['a'])
  })

  it('renders sanitized HTML and strips scripts', () => {
    const w = mount(MessageReader, {
      props: {
        message: message({
          thread: [
            threadMsg({
              html: '<p>Hej <span style="color:red">röd</span></p><scr' + 'ipt>x()</scr' + 'ipt>'
            })
          ]
        })
      }
    })
    const html = w.find('.body-html')
    expect(html.exists()).toBe(true)
    expect(html.html()).toContain('color:red')
    expect(html.html()).not.toContain('<script')
  })

  it('Send and close confirms first, then emits reply (close:true)', async () => {
    const w = mount(MessageReader, { props: { message: message() } })
    expect(w.find('[data-testid="send-reply"]').text()).toContain('Skicka och stäng')
    await w.find('[data-testid="reply-body"]').setValue('Tack!')
    await w.find('[data-testid="send-reply"]').trigger('click')
    // Nothing sent yet — the confirmation dialog is shown.
    expect(w.emitted('reply')).toBeUndefined()
    expect(w.find('[data-testid="confirm-send-close-body"]').exists()).toBe(true)
    await w.find('[data-testid="confirm-send-close"]').trigger('click')
    expect(w.emitted('reply')[0]).toEqual([{ body: 'Tack!', close: true }])
  })

  it('cancelling the confirmation keeps the draft and sends nothing', async () => {
    const w = mount(MessageReader, { props: { message: message() } })
    await w.find('[data-testid="reply-body"]').setValue('Tack!')
    await w.find('[data-testid="send-reply"]').trigger('click')
    await w.find('[data-testid="confirm-cancel"]').trigger('click')
    expect(w.emitted('reply')).toBeUndefined()
    expect(w.find('[data-testid="confirm-send-close-body"]').exists()).toBe(false)
    expect(w.find('[data-testid="reply-body"]').element.value).toBe('Tack!')
  })

  it('menu offers Send and leave open (close:false)', async () => {
    const w = mount(MessageReader, { props: { message: message() } })
    await w.find('[data-testid="reply-body"]').setValue('Tack!')
    await w.find('[data-testid="send-menu-toggle"]').trigger('click')
    await w.find('[data-testid="opt-open"]').trigger('click')
    expect(w.emitted('reply')[0]).toEqual([{ body: 'Tack!', close: false }])
  })

  it('emits set-assignee from the assignee dropdown', async () => {
    const w = mount(MessageReader, {
      props: {
        message: message(),
        assignees: [{ email: 'linn@x.se', name: 'Linn' }]
      }
    })
    await w.find('[data-testid="assignee-select"]').setValue('linn@x.se')
    expect(w.emitted('set-assignee')[0]).toEqual(['linn@x.se'])
  })

  it('emits set-state when the status dropdown changes', async () => {
    const w = mount(MessageReader, { props: { message: message() } })
    await w.find('[data-testid="state-select"]').setValue('done')
    expect(w.emitted('set-state')[0]).toEqual(['done'])
  })

  it('renders the category picker with the current category selected', () => {
    const w = mount(MessageReader, {
      props: { message: message(), categories: ['agility', 'kurser', 'styrelsen'] }
    })
    const sel = w.find('[data-testid="category-select"]')
    expect(sel.findAll('option').map((o) => o.attributes('value'))).toEqual([
      'agility',
      'kurser',
      'styrelsen'
    ])
    expect(sel.element.value).toBe('kurser')
  })

  it('includes the current category even when it is missing from the list', () => {
    const w = mount(MessageReader, {
      props: { message: message({ category: 'utveckling' }), categories: ['kurser'] }
    })
    const values = w
      .find('[data-testid="category-select"]')
      .findAll('option')
      .map((o) => o.attributes('value'))
    expect(values).toContain('utveckling')
  })

  it('emits transfer when another category is picked', async () => {
    const w = mount(MessageReader, {
      props: { message: message(), categories: ['agility', 'kurser'] }
    })
    await w.find('[data-testid="category-select"]').setValue('agility')
    expect(w.emitted('transfer')[0]).toEqual(['agility'])
  })

  it('does not emit transfer when the current category is picked again', async () => {
    const w = mount(MessageReader, {
      props: { message: message(), categories: ['agility', 'kurser'] }
    })
    await w.find('[data-testid="category-select"]').setValue('kurser')
    expect(w.emitted('transfer')).toBeUndefined()
  })

  it('interleaves notes and messages in chronological order', () => {
    const w = mount(MessageReader, {
      props: {
        message: message({
          thread: [
            threadMsg({ messageId: 'm1', receivedAt: '2026-06-01T09:00:00Z', text: 'inbound' }),
            threadMsg({ messageId: 'r1', direction: 'outbound', receivedAt: '2026-06-01T12:00:00Z', text: 'reply' })
          ],
          // note posted between the two messages
          notes: [{ text: 'mellan-anteckning', author: 'a@x', createdAt: '2026-06-01T10:00:00Z' }]
        })
      }
    })
    const blocks = w.findAll('.thread .msg')
    expect(blocks).toHaveLength(3)
    expect(blocks[0].text()).toContain('inbound')
    expect(blocks[1].text()).toContain('mellan-anteckning') // note in the middle, by time
    expect(blocks[2].text()).toContain('reply')
  })

  it('renders internal notes', () => {
    const w = mount(MessageReader, {
      props: {
        message: message({ notes: [{ text: 'ring upp', author: 'a@x', createdAt: '2026-06-03T10:00:00Z' }] })
      }
    })
    const notes = w.findAll('[data-testid="note"]')
    expect(notes).toHaveLength(1)
    expect(notes[0].text()).toContain('ring upp')
  })

  it('the note tab emits add-note instead of reply', async () => {
    const w = mount(MessageReader, { props: { message: message() } })
    await w.find('[data-testid="tab-note"]').trigger('click')
    await w.find('[data-testid="reply-body"]').setValue('Intern grej')
    await w.find('[data-testid="save-note"]').trigger('click')
    expect(w.emitted('add-note')[0]).toEqual([{ text: 'Intern grej' }])
    expect(w.emitted('reply')).toBeUndefined()
  })

  it('attachments are tappable and emit the thread member + index', async () => {
    const w = mount(MessageReader, {
      props: {
        message: message({
          thread: [
            threadMsg({
              messageId: 'r1',
              attachments: [
                { filename: 'image001.png', contentType: 'image/png', size: 2048 },
                { filename: 'offert.pdf', contentType: 'application/pdf', size: 358_400 }
              ]
            })
          ]
        })
      }
    })
    const chips = w.findAll('[data-testid="attachment"]')
    expect(chips).toHaveLength(2)
    // Buttons, not inert spans — the original bug was a chip nothing listened to.
    expect(chips[0].element.tagName).toBe('BUTTON')
    expect(chips[1].text()).toContain('offert.pdf')
    // Size is shown so an admin knows what they're pulling over mobile data.
    expect(chips[1].text()).toContain('350 kB')

    await chips[1].trigger('click')
    // The index must be the position in THIS member's list, and the id the
    // member itself — attachments hang off replies, not just the thread root.
    expect(w.emitted('download-attachment')[0]).toEqual([
      { messageId: 'r1', index: 1, filename: 'offert.pdf' }
    ])
  })

  it('an attachment with no filename still renders something tappable', () => {
    const w = mount(MessageReader, {
      props: {
        message: message({
          thread: [threadMsg({ attachments: [{ filename: null, size: 0 }] })]
        })
      }
    })
    expect(w.find('[data-testid="attachment"]').text()).toContain('bilaga')
  })

  it('the attachment being fetched says so and cannot be re-tapped', async () => {
    const w = mount(MessageReader, {
      props: {
        message: message({
          thread: [threadMsg({ messageId: 'r1', attachments: [{ filename: 'a.pdf', size: 10 }] })]
        }),
        attachmentBusy: 'r1:0'
      }
    })
    const chip = w.find('[data-testid="attachment"]')
    expect(chip.text()).toContain('Hämtar…')
    expect(chip.attributes('disabled')).toBeDefined()
  })

  it('shows the RAW download only in debug mode', async () => {
    const plain = mount(MessageReader, { props: { message: message() } })
    expect(plain.find('[data-testid="download-raw"]').exists()).toBe(false)
    const w = mount(MessageReader, { props: { message: message(), debug: true } })
    await w.find('[data-testid="download-raw"]').trigger('click')
    expect(w.emitted('download-raw')[0]).toEqual(['a'])
  })
})
