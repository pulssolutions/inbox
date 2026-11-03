// MCP endpoint: stateless Streamable HTTP, one server + transport per request.
// Every tool is a thin call into the ordinary admin routes with claims
// synthesised from the API token, so authorization, category scoping, audit and
// notifications are the handlers' own.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { resolveToken } from './tokens/admin.js'
import { hasCapability } from './auth.js'

const messageId = z
  .string()
  .describe('Thread root or any message in the thread')

const listItem = (m) => ({
  messageId: m.messageId,
  subject: m.subject,
  from: m.from,
  category: m.category,
  state: m.state || 'open',
  assignee: m.assignee ?? null,
  box: m.box,
  receivedAt: m.receivedAt,
  lastActivityAt: m.lastActivityAt,
  status: m.status
})

const threadMember = (m) => ({
  messageId: m.messageId,
  direction: m.direction,
  from: m.from,
  replyTo: m.replyTo ?? null,
  sentBy: m.sentBy,
  receivedAt: m.receivedAt,
  subject: m.subject,
  text: m.text,
  attachments: (m.attachments || []).map(({ filename, contentType, size }) => ({
    filename,
    contentType,
    size
  }))
})

// name -> [description, input shape, route, build the synthetic request, shape the result]
const TOOLS = {
  list_messages: [
    'One page of threads in a box, newest activity first',
    {
      box: z.enum(['inbox', 'archived', 'spam']).optional(),
      category: z.string().optional(),
      state: z.enum(['open', 'pending', 'done']).optional(),
      assignment: z.enum(['mine', 'unassigned']).optional(),
      cursor: z.string().optional()
    },
    'GET /admin/messages',
    (a) => ({ query: a }),
    (r) => ({ items: r.items.map(listItem), cursor: r.cursor })
  ],
  search_messages: [
    'Search thread subjects, senders and categories',
    { query: z.string() },
    'GET /admin/messages/search',
    (a) => ({ query: { q: a.query } }),
    (r) => ({ items: r.map(listItem) })
  ],
  get_message: [
    'A thread with its messages (text only) and internal notes; marks it read',
    { messageId },
    'GET /admin/messages/{messageId}',
    (a) => ({ pathParameters: { messageId: a.messageId } }),
    ({ thread, notes, drafts = [], ...m }) => ({
      ...m,
      thread: thread.map(threadMember),
      notes: notes.map(({ text, author, authorName, createdAt }) => ({
        text,
        author,
        authorName,
        createdAt
      })),
      drafts: drafts.map(({ draftId, status, reason, text, author, createdAt }) => ({
        draftId,
        status,
        reason: reason ?? null,
        text,
        author,
        createdAt
      }))
    })
  ],
  reply: [
    'Email a reply to the sender, from the category address. An owner whose replies need approval gets a draft back instead (status pending_approval)',
    { messageId, body: z.string(), subject: z.string().optional() },
    // Without send rights the same input becomes a draft for a colleague.
    ({ org, claims }) =>
      hasCapability(claims, org, 'inbox.send')
        ? 'POST /admin/messages/{messageId}/reply'
        : 'POST /admin/messages/{messageId}/drafts',
    (a) => ({
      pathParameters: { messageId: a.messageId },
      body: { body: a.body, subject: a.subject }
    }),
    ({ kind, draftId, messageId: id, to, subject, receivedAt, assignee }) =>
      kind === 'draft'
        ? { status: 'pending_approval', draftId }
        : { messageId: id, to, subject, receivedAt, assignee }
  ],
  add_note: [
    'Add an internal note, visible to admins only',
    { messageId, text: z.string() },
    'POST /admin/messages/{messageId}/notes',
    (a) => ({
      pathParameters: { messageId: a.messageId },
      body: { text: a.text }
    }),
    ({ createdAt, author, text }) => ({ createdAt, author, text })
  ],
  set_state: [
    'Set the thread state',
    { messageId, state: z.enum(['open', 'pending', 'done']) },
    'PATCH /admin/messages/{messageId}',
    (a) => ({
      pathParameters: { messageId: a.messageId },
      body: { state: a.state }
    }),
    (r) => r
  ],
  archive_message: [
    'Archive a thread, or move it back to the inbox',
    { messageId, archived: z.boolean() },
    'PATCH /admin/messages/{messageId}',
    (a) => ({
      pathParameters: { messageId: a.messageId },
      body: { box: a.archived ? 'archived' : 'inbox' }
    }),
    (r) => r
  ],
  assign_message: [
    'Assign a thread to an admin by email, or null to unassign',
    { messageId, assignee: z.string().nullable() },
    'PATCH /admin/messages/{messageId}',
    (a) => ({
      pathParameters: { messageId: a.messageId },
      body: { assignee: a.assignee }
    }),
    (r) => r
  ]
}

const buildServer = (app, { org, claims }) => {
  const server = new McpServer({ name: 'inbox', version: '1.0.0' })
  for (const [
    name,
    [description, inputSchema, route, toRequest, shape]
  ] of Object.entries(TOOLS)) {
    server.registerTool(name, { description, inputSchema }, async (args) => {
      const { query, pathParameters = {}, body } = toRequest(args)
      const routeKey = typeof route === 'function' ? route({ org, claims }) : route
      const [method] = routeKey.split(' ')
      const res = await app.handle({
        routeKey,
        requestContext: { http: { method }, authorizer: { jwt: { claims } } },
        headers: { 'x-org': org },
        queryStringParameters: query,
        pathParameters,
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      const data = res.body ? JSON.parse(res.body) : null
      if (res.statusCode >= 400) {
        return {
          content: [{ type: 'text', text: `${data.code}: ${data.message}` }],
          isError: true
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(shape(data)) }] }
    })
  }
  return server
}

const unauthorized = () => ({
  statusCode: 401,
  headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Unauthorized' },
    id: null
  })
})

export const handleMcp = async (app, event) => {
  const headers = event.headers || {}
  const bearer = (headers.authorization || headers.Authorization || '').replace(
    /^Bearer\s+/i,
    ''
  )
  const auth = await resolveToken(app.deps, bearer)
  if (!auth) return unauthorized()

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Lambda cannot stream, so answer each POST with one JSON body instead of SSE.
    enableJsonResponse: true
  })
  await buildServer(app, auth).connect(transport)
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body
  const res = await transport.handleRequest(
    new Request(
      `https://${headers.host || 'localhost'}${event.rawPath || '/mcp'}`,
      {
        method: event.requestContext?.http?.method || 'POST',
        headers,
        body
      }
    )
  )
  const text = await res.text()
  await transport.close()
  return {
    statusCode: res.status,
    headers: Object.fromEntries(res.headers),
    body: text
  }
}
