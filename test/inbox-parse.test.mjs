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
