// node --test test/
//
// The parse Lambda is inline in its CloudFormation template, so there is no
// module to import and no harness to run it in. These assert the one property
// of it that has silently broken before: what an inbound reply writes back to
// the thread root. A string check is a weak test, but it fails if someone
// edits the expression, which is exactly how the bug got in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const template = readFileSync(
  new URL('../aws/services/inbox-parse/template.yml', import.meta.url),
  'utf8'
)

const reopenExpression = () => {
  const m = template.match(/UpdateExpression:\s*\n?\s*'([^']+)'/)
  assert.ok(m, 'reopenThread no longer has a recognisable UpdateExpression')
  return m[1]
}

test('an inbound reply reopens the thread AND marks it unread', () => {
  // status is what the agent UI renders as unread (MessageList.vue). Setting
  // only state leaves a customer's reply looking like a ticket someone merely
  // touched - it re-sorts to the top of the list and nothing else changes.
  const expr = reopenExpression()
  assert.match(expr, /#s = :open/, 'must reopen a closed thread')
  assert.match(expr, /#st = :unread/, 'must mark the thread unread')
  assert.match(expr, /lastActivityAt = :t/, 'must re-sort the thread')
})

test('the reopen expression binds every name and value it uses', () => {
  const expr = reopenExpression()
  for (const name of expr.match(/#\w+/g) || []) {
    assert.match(
      template,
      new RegExp(`'${name}':\\s*'`),
      `${name} is used but never bound in ExpressionAttributeNames`
    )
  }
  for (const value of expr.match(/:\w+/g) || []) {
    assert.match(
      template,
      new RegExp(`'${value}':\\s*\\{`),
      `${value} is used but never bound in ExpressionAttributeValues`
    )
  }
})

// --------------------------------------------------------------- recipient
//
// Same trick as above, one step further: the recipient pick is lifted out of
// the YAML and actually run. It decides both who a message belongs to and
// which category it lands in, and its old form - first To: only - dropped
// every mail that merely Cc'd a support address.
const liftPickRecipient = () => {
  const split = template.match(/(const splitAddress = \(raw\) => \{[\s\S]*?\n {10}\})/)
  assert.ok(split, 'splitAddress is no longer recognisable in the template')
  const block = template.match(/--- recipient pick ---\n([\s\S]*?)\/\/ --- end recipient pick ---/)
  assert.ok(block, 'the recipient pick is no longer delimited by its markers')
  const body = `${split[1]}\n${block[1]}`.replace(/^ {10}/gm, '')
  return new Function(`${body}; return pickRecipient`)()
}

const tenants = (...domains) => {
  const calls = []
  const resolve = async (domain) => {
    calls.push(domain)
    return domains.includes(domain) ? { org: 'puls', name: 'Puls Solutions' } : null
  }
  return { resolve, calls }
}

test('a message addressed to us resolves to us', async () => {
  const pick = liftPickRecipient()
  const { resolve } = tenants('puls-solutions.com')
  const got = await pick({ to: ['hello2@puls-solutions.com'] }, [], resolve)
  assert.equal(got.category, 'hello2')
  assert.equal(got.tenant.org, 'puls')
})

test('a support address on Cc is found, not dropped', async () => {
  // The bug: only h.to[0] counted, so this resolved taby.se and vanished.
  const pick = liftPickRecipient()
  const { resolve } = tenants('puls-solutions.com')
  const got = await pick(
    { to: ['kollega@taby.se'], cc: ['Puls <HELLO2@Puls-Solutions.com>'] },
    [],
    resolve
  )
  assert.equal(got.address, 'Puls <HELLO2@Puls-Solutions.com>')
  assert.equal(got.category, 'hello2')
  assert.equal(got.tenant.org, 'puls')
})

test('a second To: address of ours is found when ours is not first', async () => {
  const pick = liftPickRecipient()
  const { resolve } = tenants('puls-solutions.com')
  const got = await pick({ to: ['kollega@taby.se', 'hello2@puls-solutions.com'] }, [], resolve)
  assert.equal(got.category, 'hello2')
})

test('forwarded mail prefers the address the customer wrote to', async () => {
  // Google forwards hello2@puls-solutions.com to the subdomain SES receives
  // on; only the apex has a tenant row, and the ticket must show the apex.
  const pick = liftPickRecipient()
  const { resolve } = tenants('puls-solutions.com')
  const got = await pick(
    { to: ['hello2@puls-solutions.com'] },
    ['hello2@inbox.puls-solutions.com'],
    resolve
  )
  assert.equal(got.address, 'hello2@puls-solutions.com')
  assert.equal(got.tenant.org, 'puls')
})

test('nothing of ours in the message is still a drop, naming the address', async () => {
  const pick = liftPickRecipient()
  const { resolve } = tenants('puls-solutions.com')
  const got = await pick({ to: ['kollega@taby.se'], cc: ['chef@taby.se'] }, [], resolve)
  assert.equal(got.tenant, null)
  assert.equal(got.address, 'kollega@taby.se')
  assert.equal(got.category, 'kollega')
})

test('a repeated domain is looked up once', async () => {
  const pick = liftPickRecipient()
  const { resolve, calls } = tenants('puls-solutions.com')
  await pick(
    { to: ['a@taby.se', 'b@taby.se', 'c@taby.se'], cc: ['hello2@puls-solutions.com'] },
    [],
    resolve
  )
  assert.deepEqual(calls, ['taby.se', 'puls-solutions.com'])
})

test('an unparseable address is skipped rather than resolved', async () => {
  const pick = liftPickRecipient()
  const { resolve, calls } = tenants('puls-solutions.com')
  const got = await pick({ to: ['undisclosed-recipients:;'], cc: ['hello2@puls-solutions.com'] }, [], resolve)
  assert.deepEqual(calls, ['puls-solutions.com'])
  assert.equal(got.category, 'hello2')
})
