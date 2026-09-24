// node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setPath, parseValue, changes } from '../scripts/profile-var.mjs'

test('setPath builds the objects along the way', () => {
  // A profile that has never had a `features` block is the normal case for
  // the first flag anyone adds.
  const p = { name: 'x' }
  setPath(p, 'features.webhook', true)
  assert.deepEqual(p, { name: 'x', features: { webhook: true } })
})

test('setPath replaces a leaf without disturbing its siblings', () => {
  const p = { ops: { logRetentionDays: 14, monthlyBudget: 10 } }
  setPath(p, 'ops.monthlyBudget', 20)
  assert.deepEqual(p.ops, { logRetentionDays: 14, monthlyBudget: 20 })
})

test('setPath overwrites a non-object standing where a branch must go', () => {
  const p = { features: 'nope' }
  setPath(p, 'features.webhook', true)
  assert.deepEqual(p.features, { webhook: true })
})

test('parseValue reads JSON where it can and keeps a plain string otherwise', () => {
  assert.equal(parseValue('true'), true)
  assert.equal(parseValue('20'), 20)
  assert.deepEqual(parseValue('["a"]'), ['a'])
  assert.equal(parseValue('inbox.example.com'), 'inbox.example.com')
  // A domain that looks numeric must not silently become a number.
  assert.equal(parseValue('example.com'), 'example.com')
})

test('changes names a nested path, not the whole subtree', () => {
  const before = { ops: { logRetentionDays: 14, monthlyBudget: 10 }, name: 'x' }
  const after = { ops: { logRetentionDays: 14, monthlyBudget: 20 }, name: 'x' }
  assert.deepEqual(changes(before, after), ['ops.monthlyBudget: 10 -> 20'])
})

test('changes reports a whole new block as one line, and a removed key', () => {
  // Nothing to recurse into when a block is new, and naming it whole reads
  // better than a list of leaves that all came from the same addition.
  assert.deepEqual(changes({}, { features: { webhook: true } }), [
    'features: undefined -> {"webhook":true}'
  ])
  assert.deepEqual(changes({ a: 1 }, {}), ['a: 1 -> undefined'])
})

test('changes treats an array as one value rather than recursing', () => {
  assert.deepEqual(changes({ d: ['a'] }, { d: ['a', 'b'] }), ['d: ["a"] -> ["a","b"]'])
})

test('changes is empty for an identical profile', () => {
  const p = { a: { b: [1, 2] }, c: 'x' }
  assert.deepEqual(changes(p, structuredClone(p)), [])
})
