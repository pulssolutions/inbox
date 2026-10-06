// node --test test/
//
// Lifts the inline auto-reply rule out of the parse Lambda's template, the same
// way spam-rule.test.mjs does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const template = readFileSync(
  new URL('../aws/services/inbox-parse/template.yml', import.meta.url),
  'utf8'
)

const inlineRule = () => {
  const m = template.match(/--- auto-reply rule ---\n([\s\S]*?)\/\/ --- end auto-reply rule ---/)
  assert.ok(m, 'the inline auto-reply rule is no longer delimited by its markers')
  const body = m[1].replace(/^ {10}/gm, '')
  return new Function(`${body}; return isAutoReply`)()
}

const isAutoReply = inlineRule()
const headers = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value }))
const viaGroup = { Precedence: 'list', 'List-ID': '<info.example.se>' }

test('an Exchange inbox-rule reply is an auto-reply', () => {
  assert.equal(
    isAutoReply(
      headers({
        ...viaGroup,
        'auto-submitted': 'auto-generated',
        'x-ms-exchange-generated-message-source': 'Mailbox Rules Agent',
        'In-Reply-To': '<invite@example.com>'
      })
    ),
    true
  )
})

test('vacation responders are auto-replies', () => {
  assert.equal(isAutoReply(headers({ 'Auto-Submitted': 'auto-replied' })), true)
  assert.equal(isAutoReply(headers({ 'Auto-Submitted': 'auto-replied; owner-email="a@x"' })), true)
  assert.equal(isAutoReply(headers({ 'X-Autoreply': 'yes' })), true)
  assert.equal(isAutoReply(headers({ 'X-Autorespond': 'x' })), true)
  assert.equal(isAutoReply(headers({ Precedence: 'auto_reply' })), true)
})

// Zendesk relays real tickets into the group marked auto-generated, and the
// group stamps Precedence: list on everything. Neither may count.
test('relayed tickets and group mail are not auto-replies', () => {
  assert.equal(
    isAutoReply(
      headers({
        ...viaGroup,
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
        'In-Reply-To': '<x@outlook.com>'
      })
    ),
    false
  )
  assert.equal(isAutoReply(headers({ 'Auto-Submitted': 'no' })), false)
  assert.equal(isAutoReply(headers(viaGroup)), false)
  assert.equal(isAutoReply(undefined), false)
})

// A rule that forwards a customer's mail to us is real mail; only a rule that
// answers something (it carries In-Reply-To) is an auto-reply.
test('an Exchange rule forward is not an auto-reply', () => {
  assert.equal(
    isAutoReply(headers({ 'x-ms-exchange-generated-message-source': 'Mailbox Rules Agent' })),
    false
  )
})

test('the handler drops an auto-reply before storing or notifying', () => {
  assert.match(template, /const autoReply = isAutoReply\(mail\.headers\)/)
  assert.match(template, /if \(org && !autoReply\) \{/)
})
