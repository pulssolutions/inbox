// node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load, validate, derive, parametersFor, webAppUrl } from '../scripts/profile.mjs'

const base = () => load('example')

test('the committed example profile is valid', () => {
  assert.deepEqual(validate(base()), [])
})

test('derived names never require a hand-typed account id', () => {
  const d = derive(base(), 'dev')
  assert.equal(d.mailBucket, 'example-inbox-mail-dev-111122223333-eu-north-1')
  assert.equal(d.table, 'example-inbox-data-dev')
  assert.equal(d.parseFunction, 'example-inbox-parse-dev')
  assert.equal(d.ruleSet, 'example-inbox-dev')
  assert.equal(
    d.sesIdentityArn,
    'arn:aws:ses:eu-north-1:111122223333:identity/example.com'
  )
  assert.equal(d.senderEmail, 'support@example.com')
})

test('a second profile changes every derived name with no code edits', () => {
  const acme = {
    ...base(),
    name: 'acme',
    accountId: '444455556666',
    region: 'eu-west-1',
    mailDomain: 'acme.com',
    org: { slug: 'acme', name: 'Acme Ltd' }
  }
  assert.deepEqual(validate(acme), [])
  const d = derive(acme, 'dev')
  assert.equal(d.mailBucket, 'acme-inbox-mail-dev-444455556666-eu-west-1')
  assert.equal(d.senderEmail, 'support@acme.com')
  assert.equal(d.sesIdentityArn, 'arn:aws:ses:eu-west-1:444455556666:identity/acme.com')
})

test('validation catches the mistakes that fail late and silently', () => {
  const bad = (patch) => validate({ ...base(), ...patch })
  assert.match(bad({ accountId: '12345' })[0], /12 digits/)
  assert.match(bad({ region: 'eu-south-2' })[0], /SES email receiving/)
  assert.match(bad({ name: 'Example_Inbox' })[0], /lowercase kebab/)
  assert.match(
    bad({ web: { domain: '', hostedZoneId: 'Z123' } })[0],
    /hostedZoneId set but web.domain is empty/
  )
  assert.match(
    bad({ auth: { google: { clientId: 'abc', secretSsm: '' } } })[0],
    /must be set together/
  )
  assert.equal(bad({ notificationEmail: '' }).length, 1)
})

// Built explicitly rather than from the committed profile: that profile now
// configures a domain, and a test that changes meaning when config changes is
// not testing what it claims.
test('no domain means the app is served on the CloudFront name', () => {
  const p = { ...base(), web: { domain: '', hostedZoneId: '' } }
  assert.equal(webAppUrl(p, {}), '', 'unknown before the distribution exists')
  assert.equal(
    webAppUrl(p, { cloudfrontDomain: 'd3tsrx8doikh07.cloudfront.net' }),
    'https://d3tsrx8doikh07.cloudfront.net'
  )
})

test('a custom domain wins over the CloudFront name', () => {
  const p = { ...base(), web: { domain: 'inbox.example.com', hostedZoneId: 'Z1' } }
  assert.equal(
    webAppUrl(p, { cloudfrontDomain: 'd3tsrx8doikh07.cloudfront.net' }),
    'https://inbox.example.com'
  )
})

test('every stack expands to parameters, with no account id left to paste', () => {
  const p = { ...base(), web: { domain: '', hostedZoneId: '' } }
  const stacks = ['account', 'billing', 'shared', 'inbox-mail', 'inbox-parse', 'inbox', 'certificates', 'web']
  for (const s of stacks) {
    const params = parametersFor(p, s, 'dev', { cloudfrontDomain: 'x.cloudfront.net' })
    assert.ok(Object.keys(params).length > 0, `${s} produced no parameters`)
    assert.equal(params.ProjectPrefix, 'example', `${s} missing prefix`)
  }
  const inbox = parametersFor(p, 'inbox', 'dev', { cloudfrontDomain: 'x.cloudfront.net' })
  assert.equal(inbox.MailBucketName, 'example-inbox-mail-dev-111122223333-eu-north-1')
  assert.equal(inbox.WebAppUrl, 'https://x.cloudfront.net')
  assert.equal(inbox.GoogleClientId, '', 'google disabled when unset')
})

test('an env not listed in the profile is refused', () => {
  assert.throws(() => parametersFor(base(), 'inbox', 'www'), /not listed/)
})

test('an unknown stack is refused', () => {
  assert.throws(() => parametersFor(base(), 'nope'), /unknown stack/)
})

test('mail DNS is stack-managed only when a zone is given', () => {
  const p = base()
  assert.equal(parametersFor(p, 'inbox-mail').MailHostedZoneId, '', 'no zone: DNS is hosted elsewhere')

  // A mail subdomain that IS in Route53: the stack owns identity + records.
  const delegated = { ...p, mail: { hostedZoneId: 'Z0MAILZONEEXAMPLE123' } }
  assert.deepEqual(validate(delegated), [])
  assert.equal(
    parametersFor(delegated, 'inbox-mail').MailHostedZoneId,
    'Z0MAILZONEEXAMPLE123'
  )
})

test('a malformed zone id is caught before CloudFormation sees it', () => {
  const bad = validate({ ...base(), mail: { hostedZoneId: 'my-zone' } })
  assert.match(bad[0], /Route53 zone id/)
})

test('a brand logo path that does not exist is rejected', () => {
  const p = { ...base(), brand: { short: 'A', tagline: 'Inbox', logo: 'deployments/assets/nope/logo.png' } }
  assert.match(validate(p).join('\n'), /brand\.logo does not exist/)
})

test('a dark logo without a light one is rejected', () => {
  // Light mode would otherwise render no artwork at all.
  const p = { ...base(), brand: { short: 'A', tagline: 'Inbox', logoDark: 'deployments/assets/example/logo-dark.png' } }
  assert.match(validate(p).join('\n'), /logoDark is set but brand\.logo is not/)
})

test('no brand artwork at all is valid - the app falls back to its own mark', () => {
  const p = { ...base(), brand: { short: 'A', tagline: 'Inbox' } }
  assert.deepEqual(validate(p), [])
})

test('a fork can supply its whole profile through the environment', () => {
  // The point: a fork configures itself with no tracked file, so merging from
  // upstream never conflicts on configuration.
  const inline = { ...base(), name: 'acme', accountId: '444455556666', region: 'eu-west-1',
    mailDomain: 'acme.example', org: { slug: 'acme', name: 'Acme Ltd' },
    brand: { short: 'Acme', tagline: 'Inbox' } }
  process.env.DEPLOY_PROFILE_JSON = JSON.stringify(inline)
  try {
    const p = load('acme')
    assert.equal(p.name, 'acme')
    assert.deepEqual(validate(p), [])
    assert.equal(derive(p, 'dev').mailBucket, 'acme-inbox-mail-dev-444455556666-eu-west-1')
  } finally {
    delete process.env.DEPLOY_PROFILE_JSON
  }
})

test('a malformed profile variable fails loudly, not silently', () => {
  process.env.DEPLOY_PROFILE_JSON = '{ not json'
  try {
    assert.throws(() => load('acme'), /not valid JSON/)
  } finally {
    delete process.env.DEPLOY_PROFILE_JSON
  }
})

test('asking for a different profile than the variable holds is an error', () => {
  process.env.DEPLOY_PROFILE_JSON = JSON.stringify({ ...base(), name: 'acme' })
  try {
    assert.throws(() => load('example'), /holds "acme"/)
  } finally {
    delete process.env.DEPLOY_PROFILE_JSON
  }
})

test('a custom domain drives the certificate and the API stays opt-in', () => {
  const p = base() // the committed profile, which configures a domain
  const cert = parametersFor(p, 'certificates')
  assert.equal(cert.WebDomainName, 'inbox.example.com')
  assert.equal(cert.HostedZoneId, p.web.hostedZoneId)

  // The API hostname derives from RootDomainName (the parent domain), so the
  // web zone must NOT be reused for it - validating there hangs, then rolls back.
  assert.equal(parametersFor(p, 'inbox').ApiHostedZoneId, '')

  const withApi = { ...p, api: { hostedZoneId: 'Z999' } }
  assert.equal(parametersFor(withApi, 'inbox').ApiHostedZoneId, 'Z999')
})
