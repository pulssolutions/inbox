// node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingTenants, seedHint } from '../scripts/tenants.mjs'

test('a domain with a tenant row is not missing', () => {
  assert.deepEqual(missingTenants(['a.example'], ['a.example']), [])
})

test('a domain with no tenant row is reported', () => {
  // The case that bit: SES accepts the mail, nothing processes it, nobody is told.
  assert.deepEqual(missingTenants(['a.example', 'b.example'], ['a.example']), ['b.example'])
})

test('comparison ignores case and surrounding space', () => {
  assert.deepEqual(missingTenants([' A.Example '], ['a.example']), [])
})

test('a domain belonging to another org still counts as present', () => {
  // Tenant rows map domain -> org, and one deployment may serve several orgs.
  // Presence is all we check: which org owns a domain is never guessed.
  assert.deepEqual(missingTenants(['b.example'], ['a.example', 'b.example']), [])
})

test('no tenant rows at all reports every domain', () => {
  // A first deploy, before the bootstrap seeds anything.
  assert.deepEqual(missingTenants(['a.example'], []), ['a.example'])
})

test('an empty mail domain list has nothing to check', () => {
  assert.deepEqual(missingTenants([], ['a.example']), [])
  assert.deepEqual(missingTenants(undefined, undefined), [])
})

test('the hint is a command that can be pasted, naming the profile org', () => {
  const hint = seedHint({ domain: 'b.example', env: 'dev', org: 'acme', prefix: 'acme' })
  assert.match(hint, /seed-tenant\.mjs/)
  assert.match(hint, /--domain b\.example/)
  assert.match(hint, /--env dev/)
  assert.match(hint, /--org acme/)
  // The prefix decides which table is written; getting it wrong seeds nothing
  // useful and is silent, so it is always spelled out.
  assert.match(hint, /INBOX_PREFIX=acme/)
})
