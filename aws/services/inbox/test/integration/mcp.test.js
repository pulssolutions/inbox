import { describe, it, expect, beforeEach } from 'vitest'
import { buildHarness } from './helper/setup.js'
import { create as createToken } from '../../src/tokens/admin.js'

const ORG = 'acme'
const boss = { email: 'boss@acme.example', name: 'Boss' }

const seedMessage = (h, overrides = {}) =>
  h.db.putMessage({
    org: ORG,
    message: {
      messageId: 'm1',
      category: 'kurser',
      from: 'Anna <anna@example.se>',
      to: ['kurser@acme.example'],
      subject: 'Fraga om kurs',
      receivedAt: '2026-06-01T10:00:00Z',
      status: 'unread',
      direction: 'inbound',
      box: 'inbox',
      s3Bucket: 'b',
      s3Key: 'inbound/m1',
      ...overrides
    }
  })

const mcpEvent = (body, token) => ({
  routeKey: 'POST /mcp',
  rawPath: '/mcp',
  requestContext: { http: { method: 'POST', path: '/mcp' } },
  headers: {
    host: 'api.example',
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body })
})

const rpc = async (h, token, method, params) => {
  const res = await h.handler(mcpEvent({ method, params }, token))
  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.body ? JSON.parse(res.body) : null
  }
}

const callTool = async (h, token, name, args) => {
  const { body } = await rpc(h, token, 'tools/call', { name, arguments: args })
  const { content, isError } = body.result
  return {
    isError,
    text: content[0].text,
    json: isError ? null : JSON.parse(content[0].text)
  }
}

describe('integration: MCP', () => {
  let h
  let secret
  beforeEach(async () => {
    h = buildHarness()
    await h.db.putTenant({ domain: 'acme.example', org: ORG, name: 'Acme BK' })
    await h.db.putAdmin({
      org: ORG,
      admin: { email: boss.email, name: 'Boss', role: 'superadmin' }
    })
    await h.db.putAdmin({
      org: ORG,
      admin: {
        email: 'leader@acme.example',
        name: 'Leader',
        role: 'admin',
        categories: ['kurser']
      }
    })
    const deps = { db: h.db }
    secret = (
      await createToken({
        deps,
        org: ORG,
        claims: boss,
        body: { name: 'bot', owner: 'leader@acme.example' }
      })
    ).data.secret
    await seedMessage(h)
    h.mailStore.seed({
      bucket: 'b',
      key: 'inbound/m1',
      parsed: {
        text: 'Hej',
        html: '<p>Hej</p>',
        attachments: [
          {
            filename: 'a.pdf',
            contentType: 'application/pdf',
            size: 3,
            content: 'abc'
          }
        ]
      }
    })
  })

  it('rejects no header, an unknown token, a removed owner and an inactive owner', async () => {
    for (const token of [undefined, 'inbx_unknown']) {
      const r = await rpc(h, token, 'tools/list')
      expect(r.status).toBe(401)
      expect(r.headers['www-authenticate']).toBe('Bearer')
      expect(r.body.error.message).toMatch(/unauthori/i)
    }
    await h.db.putAdmin({
      org: ORG,
      admin: { email: 'leader@acme.example', role: 'admin', active: false }
    })
    expect((await rpc(h, secret, 'tools/list')).status).toBe(401)
    await h.db.deleteAdmin({ org: ORG, email: 'leader@acme.example' })
    expect((await rpc(h, secret, 'tools/list')).status).toBe(401)
  })

  it('lists the tools for a valid token', async () => {
    const r = await rpc(h, secret, 'tools/list')
    expect(r.status).toBe(200)
    expect(r.body.result.tools.map((t) => t.name).sort()).toEqual([
      'add_note',
      'archive_message',
      'assign_message',
      'get_attachment',
      'get_message',
      'list_messages',
      'reply',
      'search_messages',
      'set_state'
    ])
  })

  it('get_message returns text only, attachment metadata only, and marks seen', async () => {
    const r = await callTool(h, secret, 'get_message', { messageId: 'm1' })
    expect(r.isError).toBeFalsy()
    expect(r.json.thread[0]).toEqual({
      messageId: 'm1',
      direction: 'inbound',
      from: 'Anna <anna@example.se>',
      replyTo: null,
      sentBy: undefined,
      receivedAt: '2026-06-01T10:00:00Z',
      subject: 'Fraga om kurs',
      text: 'Hej',
      attachments: [
        { index: 0, filename: 'a.pdf', contentType: 'application/pdf', size: 3 }
      ]
    })
    expect(JSON.stringify(r.json)).not.toContain('<p>')
    expect(r.json.status).toBe('read')
    expect(await h.db.listSeen({ org: ORG, threadId: 'm1' })).toMatchObject([
      { email: 'leader@acme.example' }
    ])
  })

  it('get_attachment hands back an image as an image block, text as text, else a resource', async () => {
    h.mailStore.seed({
      bucket: 'b',
      key: 'inbound/m1',
      parsed: {
        text: 'Hej',
        attachments: [
          { filename: 'a.pdf', contentType: 'application/pdf', content: '%PDF' },
          { filename: 'p.png', contentType: 'image/png', content: Buffer.from([1, 2]) },
          { filename: 'n.csv', contentType: 'text/csv', content: 'a;b' }
        ]
      }
    })
    const blocks = async (index) => {
      const { body } = await rpc(h, secret, 'tools/call', {
        name: 'get_attachment',
        arguments: { messageId: 'm1', index }
      })
      expect(body.result.isError).toBeFalsy()
      return body.result.content
    }
    expect(await blocks(1)).toEqual([
      { type: 'text', text: 'p.png (image/png, 2 bytes)' },
      { type: 'image', data: Buffer.from([1, 2]).toString('base64'), mimeType: 'image/png' }
    ])
    expect(await blocks(2)).toEqual([
      { type: 'text', text: 'n.csv (text/csv, 3 bytes)' },
      { type: 'text', text: 'a;b' }
    ])
    expect(await blocks(0)).toEqual([
      { type: 'text', text: 'a.pdf (application/pdf, 4 bytes)' },
      {
        type: 'resource',
        resource: {
          uri: 'inbox://messages/m1/attachments/0',
          mimeType: 'application/pdf',
          blob: Buffer.from('%PDF').toString('base64')
        }
      }
    ])
    const missing = await callTool(h, secret, 'get_attachment', { messageId: 'm1', index: 7 })
    expect(missing.isError).toBe(true)
    expect(missing.text).toMatch(/^ATTACHMENT_NOT_FOUND/)
  })

  it('get_attachment above the JSON limit returns the presigned URL', async () => {
    h.mailStore.seed({
      bucket: 'b',
      key: 'inbound/m1',
      parsed: {
        text: 'Hej',
        attachments: [
          { filename: 'big.bin', contentType: 'application/octet-stream', content: Buffer.alloc(4 * 1024 * 1024 + 1) }
        ]
      }
    })
    const r = await callTool(h, secret, 'get_attachment', { messageId: 'm1', index: 0 })
    expect(r.isError).toBeFalsy()
    expect(r.json).toEqual({
      filename: 'big.bin',
      contentType: 'application/octet-stream',
      size: 4 * 1024 * 1024 + 1,
      url: expect.stringMatching(/^https:\/\/s3\.example\//)
    })
  })

  it('a scoped owner gets 404 on another category', async () => {
    await seedMessage(h, { messageId: 'm2', category: 'styrelse' })
    const r = await callTool(h, secret, 'get_message', { messageId: 'm2' })
    expect(r.isError).toBe(true)
    expect(r.text).toBe('MESSAGE_NOT_FOUND: Message not found')
    const l = await callTool(h, secret, 'list_messages', {})
    expect(l.json.items.map((m) => m.messageId)).toEqual(['m1'])
    expect(Object.keys(l.json.items[0]).sort()).toEqual(
      [
        'assignee',
        'box',
        'category',
        'from',
        'lastActivityAt',
        'messageId',
        'receivedAt',
        'state',
        'status',
        'subject'
      ].sort()
    )
  })

  it('reply is audited as the token owner via mcp and sent by the owner', async () => {
    const r = await callTool(h, secret, 'reply', {
      messageId: 'm1',
      body: 'Svar'
    })
    expect(r.json).toMatchObject({
      to: ['Anna <anna@example.se>'],
      subject: 'Re: Fraga om kurs',
      assignee: 'leader@acme.example'
    })
    const sent = await h.db.getMessage({
      org: ORG,
      messageId: r.json.messageId
    })
    expect(sent.sentBy).toBe('leader@acme.example')
    const log = await h.db.listAudit({ org: ORG })
    const reply = log.find((e) => e.action === 'reply')
    expect(reply.actor).toEqual({
      email: 'leader@acme.example',
      name: 'bot',
      via: 'mcp'
    })
  })

  it('reply as a replyApproval owner drafts instead, and get_message shows the draft', async () => {
    await h.db.putAdmin({
      org: ORG,
      admin: { email: 'leader@acme.example', name: 'Leader', role: 'admin', categories: ['kurser'], replyApproval: true }
    })
    const r = await callTool(h, secret, 'reply', { messageId: 'm1', body: 'Förslag' })
    expect(r.json.status).toBe('pending_approval')
    expect(r.json.draftId).toBeTruthy()
    expect(h.ses.replies).toHaveLength(0)
    await h.db.updateNote({
      org: ORG,
      messageId: 'm1',
      createdAt: r.json.draftId,
      set: { status: 'rejected', reason: 'Nej' }
    })
    const g = await callTool(h, secret, 'get_message', { messageId: 'm1' })
    expect(g.json.drafts).toEqual([
      expect.objectContaining({ draftId: r.json.draftId, status: 'rejected', reason: 'Nej', text: 'Förslag' })
    ])
    const log = await h.db.listAudit({ org: ORG })
    expect(log.find((e) => e.action === 'draft.create').actor.via).toBe('mcp')
  })

  it('add_note, set_state, archive and assign go through the existing handlers', async () => {
    const n = await callTool(h, secret, 'add_note', {
      messageId: 'm1',
      text: 'Intern'
    })
    expect(n.json).toMatchObject({
      author: 'leader@acme.example',
      text: 'Intern'
    })
    expect(
      (
        await callTool(h, secret, 'set_state', {
          messageId: 'm1',
          state: 'done'
        })
      ).json.state
    ).toBe('done')
    expect(
      (
        await callTool(h, secret, 'archive_message', {
          messageId: 'm1',
          archived: true
        })
      ).json.box
    ).toBe('archived')
    expect(
      (
        await callTool(h, secret, 'assign_message', {
          messageId: 'm1',
          assignee: null
        })
      ).json.assignee
    ).toBeNull()
    const s = await callTool(h, secret, 'search_messages', { query: 'kurs' })
    expect(s.json.items).toHaveLength(1)
    const bad = await callTool(h, secret, 'set_state', {
      messageId: 'm1',
      state: 'open'
    })
    expect(bad.isError).toBeFalsy()
  })
})
