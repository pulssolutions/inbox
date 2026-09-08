// Vitest setup: stateful fetch shim mirroring the inbox backend API against an
// in-memory message list. Reseeded per test via beforeEach.

import { vi, beforeEach } from 'vitest'
import { config } from '@vue/test-utils'
import { setAdminTokenProvider } from '@/services/api-service'

// jsdom has no scrollTo; vue-router's scrollBehavior calls it.
if (typeof window !== 'undefined') window.scrollTo = () => {}

// Render <Teleport> content in place so tests can query modal contents.
config.global.stubs = { teleport: true }

const seed = () => [
  {
    messageId: 'm-new',
    category: 'kurser',
    from: 'Anna Svensson <anna@example.se>',
    to: ['kurser@acme.example'],
    subject: 'Fråga om nybörjarkurs',
    receivedAt: '2026-06-02T09:30:00Z',
    status: 'unread',
    direction: 'inbound',
    box: 'inbox',
    s3Bucket: 'b',
    s3Key: 'inbound/m-new',
    _body: { text: 'Hej! När börjar nästa kurs?', html: null, attachments: [] }
  },
  {
    messageId: 'm-old',
    category: 'styrelse',
    from: 'Björn <bjorn@example.se>',
    to: ['styrelse@acme.example'],
    subject: 'Mötesprotokoll',
    receivedAt: '2026-05-20T11:00:00Z',
    status: 'read',
    direction: 'inbound',
    box: 'inbox',
    s3Bucket: 'b',
    s3Key: 'inbound/m-old',
    _body: {
      text: 'Bifogar protokollet.',
      html: null,
      attachments: [
        {
          filename: 'protokoll.pdf',
          contentType: 'application/pdf',
          size: 13,
          content: '%PDF-1.4 stub'
        }
      ]
    }
  },
  {
    messageId: 'm-arch',
    category: 'kurser',
    from: 'Cecilia <cissi@example.se>',
    to: ['kurser@acme.example'],
    subject: 'Tack för hjälpen',
    receivedAt: '2026-05-01T08:00:00Z',
    status: 'read',
    direction: 'inbound',
    box: 'archived',
    s3Bucket: 'b',
    s3Key: 'inbound/m-arch',
    _body: { text: 'Tack!', html: null, attachments: [] }
  }
]

const state = { messages: [], notes: [], admins: [], audit: [] }
let replyCounter = 0
let noteCounter = 0

const seedAdmins = () => [
  { email: 'boss@acme.example', name: 'Boss', role: 'superadmin', active: true, categories: [] },
  { email: 'leader@acme.example', name: 'Leader', role: 'admin', active: true, categories: ['kurser'] }
]

export const resetTestApi = () => {
  state.messages = seed().map((m) => ({ state: 'open', ...m }))
  state.notes = []
  state.admins = seedAdmins()
  state.audit = [
    { id: 'a3', ts: '2026-06-03T13:00:00Z', actor: { email: 'boss@acme.example', name: 'Boss' }, action: 'state', targetType: 'message', targetLabel: 'Agility?', meta: { state: { from: 'open', to: 'done' } } },
    { id: 'a2', ts: '2026-06-03T12:00:00Z', actor: { email: 'boss@acme.example', name: 'Boss' }, action: 'delete', targetType: 'message', targetLabel: 'Skräppost' },
    { id: 'a1', ts: '2026-06-03T09:00:00Z', actor: { email: 'boss@acme.example', name: 'Boss' }, action: 'reply', targetType: 'message', targetLabel: 'Fråga om kurs' }
  ]
  replyCounter = 0
  noteCounter = 0
}

setAdminTokenProvider(() => 'test-token')
resetTestApi()

const jsonResponse = (status, data) => {
  if (status === 204) return new Response(null, { status })
  return new Response(data == null ? '' : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

const decodeBody = (init) => {
  if (!init?.body) return null
  try {
    return JSON.parse(init.body)
  } catch {
    return init.body
  }
}

// Strip the internal _body before returning a list/index row.
const indexOf = (m) => {
  const copy = { ...m }
  delete copy._body
  return copy
}

const handle = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  const method = (init.method || 'GET').toUpperCase()
  const u = new URL(url)
  const path = u.pathname
  const query = Object.fromEntries(u.searchParams.entries())
  const body = decodeBody(init)

  if (method === 'GET' && path === '/admin/messages') {
    const box = query.box || 'inbox'
    let list = state.messages.filter(
      (m) => m.box === box && (m.threadId || m.messageId) === m.messageId
    )
    if (query.category) list = list.filter((m) => m.category === query.category)
    list = [...list].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
    return jsonResponse(200, list.map(indexOf))
  }

  if (path === '/admin/messages/search' && method === 'GET') {
    const term = String(query.q || '').toLowerCase()
    const hits = state.messages
      .filter((x) => (x.threadId || x.messageId) === x.messageId)
      .filter((x) => `${x.subject || ''} ${x.from || ''} ${x.category || ''}`.toLowerCase().includes(term))
    return jsonResponse(200, term ? hits.map(indexOf) : [])
  }

  if (path === '/admin/assignees' && method === 'GET') {
    return jsonResponse(200, state.admins.map((a) => ({ email: a.email, name: a.name })))
  }

  if (path === '/admin/categories' && method === 'GET') {
    const all = new Set(state.messages.map((x) => x.category).filter(Boolean))
    for (const a of state.admins) for (const c of a.categories || []) all.add(c)
    return jsonResponse(200, [...all].sort((a, b) => a.localeCompare(b, 'sv')))
  }

  let m = path.match(/^\/admin\/messages\/([^/]+)\/attachments\/([^/]+)$/)
  if (m && method === 'GET') {
    const id = decodeURIComponent(m[1])
    const index = Number(m[2])
    const msg = state.messages.find((x) => x.messageId === id)
    const found = msg?._body?.attachments?.[index]
    if (!found) return jsonResponse(404, { code: 'ATTACHMENT_NOT_FOUND' })
    const content = found.content ?? 'stub-bytes'
    return jsonResponse(200, {
      filename: found.filename || `bilaga-${index + 1}`,
      contentType: found.contentType || 'application/octet-stream',
      size: content.length,
      contentBase64: btoa(content)
    })
  }

  m = path.match(/^\/admin\/messages\/([^/]+)\/raw$/)
  if (m && method === 'GET') {
    const id = decodeURIComponent(m[1])
    const msg = state.messages.find((x) => x.messageId === id)
    if (!msg) return jsonResponse(404, { code: 'MESSAGE_NOT_FOUND' })
    return jsonResponse(200, { raw: `Raw MIME for ${id}`, filename: `${id}.eml` })
  }

  m = path.match(/^\/admin\/messages\/([^/]+)$/)
  if (m && method === 'GET') {
    const id = decodeURIComponent(m[1])
    const msg = state.messages.find((x) => x.messageId === id)
    if (!msg) return jsonResponse(404, { code: 'MESSAGE_NOT_FOUND' })
    msg.status = 'read'
    const notes = state.notes.filter((n) => n.messageId === id)
    const root = msg.threadId || msg.messageId
    const thread = state.messages
      .filter(
        (x) =>
          (x.threadId || x.messageId) === root ||
          x.inReplyTo === root ||
          x.messageId === root
      )
      .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1))
      .map((x) => ({
        messageId: x.messageId,
        direction: x.direction,
        from: x.from,
        receivedAt: x.receivedAt,
        subject: x.subject,
        text: x._body?.text ?? x.bodyText ?? '',
        html: x._body?.html ?? null,
        // Metadata only, like the real API — bytes come from the
        // /attachments/:index route, never from the thread payload.
        attachments: (x._body?.attachments ?? []).map(
          ({ content, ...meta }) => meta // eslint-disable-line no-unused-vars
        )
      }))
    return jsonResponse(200, { ...indexOf(msg), status: 'read', thread, notes })
  }
  if (m && method === 'PATCH') {
    const id = decodeURIComponent(m[1])
    const msg = state.messages.find((x) => x.messageId === id)
    if (!msg) return jsonResponse(404, { code: 'MESSAGE_NOT_FOUND' })
    if (body.box) msg.box = body.box
    if (body.status) msg.status = body.status
    if (body.state) msg.state = body.state
    if (body.assignee !== undefined) msg.assignee = body.assignee
    return jsonResponse(200, indexOf(msg))
  }
  if (m && method === 'DELETE') {
    const id = decodeURIComponent(m[1])
    const msg = state.messages.find((x) => x.messageId === id)
    if (!msg) return jsonResponse(404, { code: 'MESSAGE_NOT_FOUND' })
    if (msg.box !== 'archived') return jsonResponse(400, { code: 'NOT_ARCHIVED' })
    const root = msg.threadId || msg.messageId
    state.messages = state.messages.filter(
      (x) => (x.threadId || x.messageId) !== root && x.messageId !== root
    )
    return jsonResponse(204, null)
  }

  m = path.match(/^\/admin\/messages\/([^/]+)\/reply$/)
  if (m && method === 'POST') {
    const id = decodeURIComponent(m[1])
    const orig = state.messages.find((x) => x.messageId === id)
    if (!orig) return jsonResponse(404, { code: 'MESSAGE_NOT_FOUND' })
    replyCounter += 1
    const outbound = {
      messageId: `reply-${replyCounter}`,
      category: orig.category,
      from: 'support@acme.example',
      to: [orig.from],
      subject: body.subject || `Re: ${orig.subject}`,
      receivedAt: new Date('2026-06-02T12:00:00Z').toISOString(),
      status: 'read',
      direction: 'outbound',
      inReplyTo: id,
      threadId: orig.threadId || orig.messageId,
      bodyText: body.body,
      box: 'inbox'
    }
    state.messages.push({ ...outbound, _body: { text: body.body, html: null, attachments: [] } })
    return jsonResponse(201, outbound)
  }

  m = path.match(/^\/admin\/messages\/([^/]+)\/transfer$/)
  if (m && method === 'POST') {
    const id = decodeURIComponent(m[1])
    const msg = state.messages.find((x) => x.messageId === id)
    if (!msg) return jsonResponse(404, { code: 'MESSAGE_NOT_FOUND' })
    const to = String(body.category || '').toLowerCase()
    const root = msg.threadId || msg.messageId
    for (const x of state.messages) {
      if ((x.threadId || x.messageId) === root) {
        x.category = to
        x.assignee = null
      }
    }
    return jsonResponse(200, { ...indexOf(msg), category: to, assignee: null })
  }

  m = path.match(/^\/admin\/messages\/([^/]+)\/notes$/)
  if (m && method === 'POST') {
    const id = decodeURIComponent(m[1])
    const msg = state.messages.find((x) => x.messageId === id)
    if (!msg) return jsonResponse(404, { code: 'MESSAGE_NOT_FOUND' })
    noteCounter += 1
    const note = {
      messageId: id,
      text: body.text,
      author: 'dev@acme.example',
      createdAt: new Date(`2026-06-03T1${noteCounter}:00:00Z`).toISOString()
    }
    state.notes.push(note)
    return jsonResponse(201, note)
  }

  if (path === '/admin/audit' && method === 'GET') {
    return jsonResponse(200, state.audit)
  }

  if (path === '/admin/admins' && method === 'GET') {
    return jsonResponse(200, state.admins)
  }
  if (path === '/admin/admins' && method === 'POST') {
    const email = String(body.email).toLowerCase()
    if (state.admins.some((a) => a.email === email)) {
      return jsonResponse(409, { code: 'ADMIN_EXISTS' })
    }
    const created = { active: true, categories: [], ...body, email }
    state.admins.push(created)
    return jsonResponse(201, created)
  }
  m = path.match(/^\/admin\/admins\/([^/]+)$/)
  if (m && method === 'PATCH') {
    const email = decodeURIComponent(m[1]).toLowerCase()
    const idx = state.admins.findIndex((a) => a.email === email)
    if (idx < 0) return jsonResponse(404, { code: 'ADMIN_NOT_FOUND' })
    state.admins[idx] = { ...state.admins[idx], ...body, email }
    return jsonResponse(200, state.admins[idx])
  }
  if (m && method === 'DELETE') {
    const email = decodeURIComponent(m[1]).toLowerCase()
    const supers = state.admins.filter((a) => a.active !== false && a.role === 'superadmin')
    if (supers.length === 1 && supers[0].email === email) {
      return jsonResponse(409, { code: 'LAST_SUPERADMIN' })
    }
    state.admins = state.admins.filter((a) => a.email !== email)
    return jsonResponse(204, null)
  }

  return jsonResponse(404, {
    code: 'NO_ROUTE',
    message: `No mock for ${method} ${path}`
  })
}

globalThis.fetch = vi.fn(handle)

beforeEach(() => {
  resetTestApi()
})
