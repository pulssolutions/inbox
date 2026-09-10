import { describe, it, expect } from 'vitest'
import { FakeDocClient } from '../helper/fake-doc-client.js'
import { FakeSes } from '../helper/fake-ses.js'
import { FakeMailStore } from '../helper/fake-mail-store.js'
import { Database } from '../../src/database.js'
import { reply } from '../../src/messages/admin.js'

const ORG = 'acme'
const CLAIMS = {
  email: 'agent@acme.example',
  orgs: JSON.stringify({
    acme: {
      name: 'Acme Ltd',
      capabilities: { inbox: { read: true, write: true, send: true } },
      categories: '*'
    }
  })
}

// The environment receives on two domains. Both are verified SES identities -
// they have to be, or SES would not have accepted the mail in the first place -
// so either is legitimate to send from.
const makeDeps = (mailDomains = ['acme.example', 'acme.net']) => {
  const docClient = new FakeDocClient()
  return {
    db: new Database({ docClient, tableName: 'inbox-test' }),
    ses: new FakeSes(),
    mailStore: new FakeMailStore(),
    sender: 'support@acme.example',
    mailDomains,
    webBaseUrl: 'https://inbox.acme.example'
  }
}

const inbound = (to) => ({
  messageId: 'm1',
  category: 'kurser',
  from: 'Anna <anna@example.se>',
  to,
  subject: 'Fraga',
  receivedAt: '2026-06-01T10:00:00Z',
  status: 'unread',
  direction: 'inbound',
  box: 'inbox',
  state: 'open',
  threadId: 'm1'
})

const replyTo = async (deps, to) => {
  await deps.db.putMessage({ org: ORG, message: inbound(to) })
  await reply({
    deps,
    org: ORG,
    pathParameters: { messageId: 'm1' },
    body: { body: 'Hej!' },
    claims: CLAIMS
  })
  return deps.ses.replies[0]
}

describe('the reply comes from the domain the customer wrote to', () => {
  it('answers a message sent to the secondary domain from that domain', async () => {
    // The whole point: writing to acme.net and being answered from
    // acme.example looks like a different company - or a phishing attempt.
    const deps = makeDeps()
    const sent = await replyTo(deps, ['kurser@acme.net'])
    expect(sent.fromAddress).toBe('kurser@acme.net')
  })

  it('answers a message sent to the primary domain from that domain', async () => {
    const deps = makeDeps()
    const sent = await replyTo(deps, ['kurser@acme.example'])
    expect(sent.fromAddress).toBe('kurser@acme.example')
  })

  it('ignores recipients that are not ours, such as someone cc-ed', async () => {
    // Sending as a domain we do not own would fail SES, or worse, pass and
    // forge someone else's domain.
    const deps = makeDeps()
    const sent = await replyTo(deps, ['someone@partner.example', 'kurser@acme.net'])
    expect(sent.fromAddress).toBe('kurser@acme.net')
  })

  it('falls back to the configured sender when no recipient is ours', async () => {
    // Forwarded mail: the visible To may be an address we never owned.
    const deps = makeDeps()
    const sent = await replyTo(deps, ['someone@partner.example'])
    expect(sent.fromAddress).toBe('kurser@acme.example')
  })

  it('falls back when the stored message has no recipients at all', async () => {
    const deps = makeDeps()
    const sent = await replyTo(deps, [])
    expect(sent.fromAddress).toBe('kurser@acme.example')
  })

  it('behaves exactly as before when no mail domains are configured', async () => {
    // An older deployment whose Lambda predates MAIL_DOMAINS must not change.
    const deps = makeDeps()
    delete deps.mailDomains // as an older Lambda, with no MAIL_DOMAINS in its env
    const sent = await replyTo(deps, ['kurser@acme.net'])
    expect(sent.fromAddress).toBe('kurser@acme.example')
  })

  it('matches the domain case-insensitively and ignores display names', async () => {
    const deps = makeDeps()
    const sent = await replyTo(deps, ['Acme Kurser <Kurser@ACME.NET>'])
    expect(sent.fromAddress).toBe('kurser@acme.net')
  })

  it('keeps the display name and website on the org, not the domain', async () => {
    const deps = makeDeps()
    const sent = await replyTo(deps, ['kurser@acme.net'])
    expect(sent.fromName).toBe('Acme Ltd - Kurser')
    expect(sent.website).toBe('https://www.acme.example')
  })
})
