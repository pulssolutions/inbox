#!/usr/bin/env node
// Local dev server: wraps the inbox Lambda handler in Express on
// http://localhost:3600, backed by the in-memory fakes used in tests (no AWS).
// Seeded with a couple of inbound messages so the admin views are populated.
//
// Usage:
//   cd aws/services/inbox
//   npm run dev
//
// Mock JWT for admin calls — base64url-encode any JSON payload carrying
// `organizationId` and an `orgs` claim, then send:
//   Authorization: Bearer <header>.<payload>.<sig>
// (header + sig can be any non-empty strings; only the payload is parsed.)

import express from 'express'
import { createApp } from '../src/app.js'
import { Database } from '../src/database.js'
import { FakeDocClient } from '../test/helper/fake-doc-client.js'
import { FakeSes } from '../test/helper/fake-ses.js'
import { FakeMailStore } from '../test/helper/fake-mail-store.js'

const PORT = Number(process.env.PORT) || 3600
const ORG = 'acme'

const docClient = new FakeDocClient()
const db = new Database({ docClient, tableName: 'inbox-local' })
const ses = new FakeSes()
const mailStore = new FakeMailStore()
const app = createApp({ deps: { db, ses, mailStore, sender: 'support@acme.example' } })

// ---- Seed data --------------------------------------------------------

const SEED = [
  {
    messageId: 'seed-1',
    category: 'kurser',
    from: 'Anna Svensson <anna@example.se>',
    to: ['kurser@acme.example'],
    subject: 'Fråga om nybörjarkurs',
    receivedAt: '2026-06-01T09:30:00Z',
    status: 'unread',
    direction: 'inbound',
    box: 'inbox',
    s3Bucket: 'local',
    s3Key: 'inbound/seed-1'
  },
  {
    messageId: 'seed-2',
    category: 'styrelse',
    from: 'Björn <bjorn@example.se>',
    to: ['styrelse@acme.example'],
    subject: 'Mötesprotokoll',
    receivedAt: '2026-06-02T11:00:00Z',
    status: 'unread',
    direction: 'inbound',
    box: 'inbox',
    s3Bucket: 'local',
    s3Key: 'inbound/seed-2'
  }
]

for (const m of SEED) {
  await db.putMessage({ org: ORG, message: m })
  mailStore.seed({
    bucket: 'local',
    key: m.s3Key,
    parsed: {
      text: `Hej! Detta är exempeltext för "${m.subject}".`,
      html: null,
      attachments: []
    }
  })
}

// ---- Mock JWT ---------------------------------------------------------

const decodeClaims = (auth) => {
  if (!auth || !auth.startsWith('Bearer ')) return null
  const parts = auth.slice(7).split('.')
  if (parts.length < 2) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

// ---- Express ----------------------------------------------------------

const server = express()
server.use(express.text({ type: '*/*' }))

// In production API Gateway answers CORS preflight; there is no OPTIONS route
// in the handler, so locally the browser's preflight 404s and every request
// from the web app on :5173 fails before it is sent.
server.options(/.*/, (req, res) => {
  res.set({
    'access-control-allow-origin': req.headers.origin || '*',
    'access-control-allow-headers': 'authorization,content-type,x-org',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'access-control-max-age': '600'
  })
  res.status(204).end()
})

server.all(/.*/, async (req, res) => {
  const claims = decodeClaims(req.headers.authorization)
  const event = {
    routeKey: `${req.method} ${req.path}`,
    rawPath: req.path,
    requestContext: {
      http: { method: req.method },
      ...(claims ? { authorizer: { jwt: { claims } } } : {})
    },
    headers: { host: req.headers.host },
    queryStringParameters: req.query,
    pathParameters: {},
    body: req.body && req.body.length ? req.body : undefined
  }
  // Route admin paths through the proxy translation the real API uses.
  if (req.path.startsWith('/admin/')) {
    event.routeKey = `${req.method} /admin/{proxy+}`
  }
  const result = await app.handle(event)
  // Echo the caller's origin so a browser accepts the response; the handler's
  // own '*' is fine for API Gateway but not for credentialed browser fetches.
  if (req.headers.origin) res.set('access-control-allow-origin', req.headers.origin)
  res.status(result.statusCode)
  for (const [k, v] of Object.entries(result.headers || {})) res.set(k, v)
  res.send(result.body)
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`inbox dev server on http://localhost:${PORT} (org ${ORG})`)
})
