// node --test test/
//
// The parse Lambda is inline in its CloudFormation template, so its copy of the
// notification rule cannot be imported. The issue that split the flags asked for
// the two to be proven equal rather than read side by side: this lifts the
// inline copy out of the YAML, runs it, and asserts it answers exactly like the
// service's module over every combination that matters.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { notifyRecipients, notifyPref } from '../aws/services/inbox/src/notify.js'

const template = readFileSync(
  new URL('../aws/services/inbox-parse/template.yml', import.meta.url),
  'utf8'
)

const inlineRule = () => {
  const m = template.match(
    /--- notify rule[^\n]*\n([\s\S]*?)\/\/ --- end notify rule ---/
  )
  assert.ok(m, 'the inline notify rule is no longer delimited by its markers')
  const body = m[1].replace(/^ {10}/gm, '')
  return new Function(`${body}; return { notifyPref, notifyRecipients }`)()
}

// Every shape a row can be in: pre-split (no notifyReply key), inheriting
// (null), and each explicit choice - crossed with the things that decide
// whether a row is even a candidate. Holding role, categories and active
// fixed made the flag rule the only thing under test: the category scoping
// and the active check could both be deleted from the inline copy with every
// assertion still passing.
const WHO = [
  { role: 'superadmin', categories: [] },
  { role: 'superadmin', categories: ['kurser'] },
  { role: 'admin', categories: ['kurser'] },
  { role: 'admin', categories: ['annat'] },
  { role: 'admin', categories: [] },
  { role: 'admin' },
  { role: 'admin', categories: ['kurser'], active: false },
  { role: 'superadmin', categories: [], active: false }
]

const ROWS = WHO.flatMap((who) =>
  [undefined, null, true, false].flatMap((notifyNewIssue) =>
    [undefined, null, true, false].map((notifyReply) => {
      const a = { email: 'a@x.se', ...who }
      if (notifyNewIssue !== undefined) a.notifyNewIssue = notifyNewIssue
      if (notifyReply !== undefined) a.notifyReply = notifyReply
      return a
    })
  )
)

const ORG_DEFAULTS = [undefined, {}, { newIssue: false }, { reply: true }, { newIssue: false, reply: true }]

test('the inline copy resolves every flag combination the same way', () => {
  const inline = inlineRule()
  for (const row of ROWS) {
    for (const event of ['newIssue', 'reply']) {
      for (const defaults of ORG_DEFAULTS) {
        assert.equal(
          inline.notifyPref(row, event, defaults),
          notifyPref(row, event, defaults),
          `${event} ${JSON.stringify(row)} defaults=${JSON.stringify(defaults)}`
        )
      }
    }
  }
})

test('the inline copy picks the same recipients', () => {
  const inline = inlineRule()
  const admins = ROWS.map((r, i) => ({ ...r, email: `a${i}@x.se` }))
  for (const event of ['newIssue', 'reply']) {
    for (const orgDefaults of ORG_DEFAULTS) {
      assert.deepEqual(
        inline.notifyRecipients(admins, 'kurser', { event, orgDefaults }),
        notifyRecipients(admins, 'kurser', { event, orgDefaults })
      )
    }
  }
})

test('the inline copy keeps a DynamoDB flag tri-state', () => {
  const { notifyFlag } = new Function(
    `${readFileSync(new URL('../aws/services/inbox-parse/template.yml', import.meta.url), 'utf8')
      .match(/--- notify rule[^\n]*\n([\s\S]*?)\/\/ --- end notify rule ---/)[1]
      .replace(/^ {10}/gm, '')}; return { notifyFlag }`
  )()
  assert.equal(notifyFlag(undefined), undefined, 'absent must stay absent')
  assert.equal(notifyFlag({ NULL: true }), null, 'null means inherit, not on')
  assert.equal(notifyFlag({ BOOL: true }), true)
  assert.equal(notifyFlag({ BOOL: false }), false)
})
