// node --test test/
//
// The parse Lambda is inline in its CloudFormation template, so its spam rule
// cannot be imported. This lifts it out of the YAML and runs it, the same way
// notify-parity.test.mjs does with the notification rule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const template = readFileSync(
  new URL('../aws/services/inbox-parse/template.yml', import.meta.url),
  'utf8'
)

const inlineRule = () => {
  const m = template.match(/--- spam rule ---\n([\s\S]*?)\/\/ --- end spam rule ---/)
  assert.ok(m, 'the inline spam rule is no longer delimited by its markers')
  const body = m[1].replace(/^ {10}/gm, '')
  return new Function(`${body}; return isSpam`)()
}

const isSpam = inlineRule()
const verdict = (status) => ({ status })

test('a hard spam FAIL is spam', () => {
  assert.equal(isSpam({ spamVerdict: verdict('FAIL') }), true)
})

test('a hard virus FAIL is spam', () => {
  assert.equal(isSpam({ virusVerdict: verdict('FAIL') }), true)
})

test('anything short of FAIL is not spam', () => {
  for (const status of ['PASS', 'GRAY', 'PROCESSING_FAILED', 'DISABLED', '']) {
    assert.equal(
      isSpam({ spamVerdict: verdict(status), virusVerdict: verdict(status) }),
      false,
      status
    )
  }
})

test('a missing verdict or receipt is not spam', () => {
  assert.equal(isSpam({}), false)
  assert.equal(isSpam(undefined), false)
  assert.equal(isSpam({ spamVerdict: {} }), false)
})

// The rule is only worth having if the handler acts on it. Nothing else here
// can see the handler run - it is inline YAML with a module-level AWS client -
// so assert the three places the verdict has to reach.
test('the handler files the verdict and stays quiet about it', () => {
  assert.match(template, /const spam = isSpam\(r\.ses\.receipt\)/)
  assert.match(template, /box: spam \? 'spam' : 'inbox'/)
  assert.match(template, /if \(!spam\) \{\n\s*await notifyAdmins\(\{/)
})

// The case this test exists for. Mail reaches us forwarded through a Google
// group, which breaks SPF, re-signs over a rewritten From: and so fails DMARC
// for perfectly legitimate senders. If someone folds those verdicts into the
// rule, real customer mail starts disappearing into Spam - and this fails.
test('failed spf, dkim and dmarc are not spam on their own', () => {
  assert.equal(
    isSpam({
      spamVerdict: verdict('PASS'),
      virusVerdict: verdict('PASS'),
      spfVerdict: verdict('FAIL'),
      dkimVerdict: verdict('FAIL'),
      dmarcVerdict: verdict('FAIL')
    }),
    false
  )
})
