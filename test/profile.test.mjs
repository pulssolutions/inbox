// node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load, validate, derive, parametersFor, webAppUrl, envNames, envConfig } from '../scripts/profile.mjs'

const base = () => load('example')

test('the committed example profile is valid', () => {
  assert.deepEqual(validate(base()), [])
})

test('derived names never require a hand-typed account id', () => {
  const d = derive(base(), 'dev')
  assert.equal(d.mailBucket, 'example-inbox-mail-dev-111122223333-eu-north-1')
  assert.equal(d.table, 'example-inbox-data-dev')
  assert.equal(d.parseFunction, 'example-inbox-parse-dev')
  assert.equal(d.ruleSet, 'example-inbox', 'account-wide: SES activates one rule set per account')
  assert.equal(d.ruleName, 'example-inbox-dev')
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

// --------------------------------------------------- per-environment config
//
// One profile, several environments, each with its own web hostname and its
// own set of inbound mail domains. The top-level values stay the defaults, so
// a single-environment profile needs none of this.

const multi = () => ({
  ...base(),
  environments: {
    dev: {
      mailDomains: ['example.net'],
      web: { domain: 'inbox-dev.example.com', hostedZoneId: 'Z0DEVZONEEXAMPLE1234' }
    },
    www: {
      mailDomains: ['example.com', 'example.org'],
      web: { domain: 'inbox.example.com', hostedZoneId: 'Z0123456789ABCDEFGHIJ' }
    }
  }
})

test('the old list form is refused, with the replacement in the message', () => {
  // A list cannot express per-environment domains, and no two environments may
  // share one - so a list is only ever valid with a single entry. Say so.
  const p = { ...base(), environments: ['dev', 'www'] }
  assert.match(validate(p).join('\n'), /must be a map of name -> overrides/)
  assert.match(validate(p).join('\n'), /write \{"dev": \{\}\}/)
})

test('a profile with no environments key at all defaults to dev', () => {
  const p = { ...base() }
  delete p.environments
  assert.deepEqual(envNames(p), ['dev'])
  assert.deepEqual(validate(p), [])
  assert.deepEqual(envConfig(p, 'dev').mailDomains, ['example.com'], 'inherits the top level')
})

test('each environment resolves its own web domain and mail domains', () => {
  const p = multi()
  assert.deepEqual(envNames(p).sort(), ['dev', 'www'])
  assert.deepEqual(envConfig(p, 'dev').mailDomains, ['example.net'])
  assert.deepEqual(envConfig(p, 'www').mailDomains, ['example.com', 'example.org'])
  assert.equal(envConfig(p, 'dev').web.domain, 'inbox-dev.example.com')
  assert.equal(envConfig(p, 'www').web.domain, 'inbox.example.com')
})

test('an environment that overrides nothing falls back to the top-level values', () => {
  const p = { ...base(), environments: { dev: {}, www: { mailDomains: ['example.org'] } } }
  assert.deepEqual(envConfig(p, 'dev').mailDomains, ['example.com'], 'inherits mailDomain')
  assert.equal(envConfig(p, 'dev').web.domain, 'inbox.example.com', 'inherits web.domain')
  assert.equal(envConfig(p, 'www').web.domain, 'inbox.example.com')
})

test('the first mail domain of an environment is the one it sends from', () => {
  const p = multi()
  const dev = derive(p, 'dev')
  const www = derive(p, 'www')
  assert.equal(dev.senderEmail, 'support@example.net')
  assert.equal(www.senderEmail, 'support@example.com')
  assert.equal(dev.sesIdentityArn, 'arn:aws:ses:eu-north-1:111122223333:identity/example.net')
  assert.equal(www.sesIdentityArn, 'arn:aws:ses:eu-north-1:111122223333:identity/example.com')
})

test('the receipt rule set is account-wide, the rule inside it is per environment', () => {
  // SES activates ONE rule set per account per region, so two environments
  // that each owned a rule set could never receive mail at the same time.
  const p = multi()
  assert.equal(derive(p, 'dev').ruleSet, 'example-inbox')
  assert.equal(derive(p, 'www').ruleSet, 'example-inbox')
  assert.equal(derive(p, 'dev').ruleName, 'example-inbox-dev')
  assert.equal(derive(p, 'www').ruleName, 'example-inbox-www')
})

test('the mail stack receives every domain for its environment, and only those', () => {
  const p = multi()
  const dev = parametersFor(p, 'inbox-mail', 'dev')
  const www = parametersFor(p, 'inbox-mail', 'www')
  assert.equal(dev.RecipientDomains, 'example.net')
  assert.equal(www.RecipientDomains, 'example.com,example.org')
  assert.equal(dev.ReceiptRuleSetName, 'example-inbox')
  assert.equal(www.ReceiptRuleSetName, 'example-inbox')
  assert.equal(dev.RuleName, 'example-inbox-dev')
  assert.ok(!www.RecipientDomains.includes('example.net'), 'dev mail must not reach www')
})

test('web and certificate stacks follow the environment, not the profile default', () => {
  const p = multi()
  assert.equal(parametersFor(p, 'web', 'dev').DomainName, 'inbox-dev.example.com')
  assert.equal(parametersFor(p, 'web', 'www').DomainName, 'inbox.example.com')
  assert.equal(parametersFor(p, 'web', 'dev').HostedZoneId, 'Z0DEVZONEEXAMPLE1234')
  assert.equal(parametersFor(p, 'certificates', 'dev').WebDomainName, 'inbox-dev.example.com')
  assert.equal(parametersFor(p, 'certificates', 'www').WebDomainName, 'inbox.example.com')
})

test('the app origin and Cognito callbacks are per environment', () => {
  const p = multi()
  assert.equal(webAppUrl(p, {}, 'dev'), 'https://inbox-dev.example.com')
  assert.equal(webAppUrl(p, {}, 'www'), 'https://inbox.example.com')
  assert.equal(parametersFor(p, 'inbox', 'dev').WebAppUrl, 'https://inbox-dev.example.com')
  assert.equal(parametersFor(p, 'inbox', 'www').WebAppUrl, 'https://inbox.example.com')
})

test('two environments may not claim the same mail domain', () => {
  // Both rules live in one rule set; SES would match the first and the other
  // environment would silently never see the mail.
  const p = { ...base(), environments: { dev: { mailDomains: ['example.com'] }, www: { mailDomains: ['example.com'] } } }
  assert.match(validate(p).join('\n'), /example\.com is claimed by more than one environment/)
})

test('the same clash is caught when it comes from the defaults', () => {
  // Neither environment overrides mailDomains, so both inherit the top-level
  // one - a profile that looks fine and receives mail in one environment only.
  const p = { ...base(), environments: { dev: {}, www: {} } }
  assert.match(validate(p).join('\n'), /claimed by more than one environment/)
})

test('an environment with no mail domain is rejected', () => {
  const p = { ...base(), environments: { dev: { mailDomains: [] } } }
  assert.match(validate(p).join('\n'), /environments\.dev\.mailDomains is empty/)
})

test('a per-environment web zone without a domain is rejected', () => {
  const p = {
    ...base(),
    web: {},
    environments: { dev: { web: { hostedZoneId: 'Z1' } } }
  }
  assert.match(validate(p).join('\n'), /environments\.dev\.web\.hostedZoneId set but/)
})

test('a mail domain that is not a domain is caught here, not by SES', () => {
  const p = { ...base(), environments: { dev: { mailDomains: ['not a domain'] } } }
  assert.match(validate(p).join('\n'), /environments\.dev\.mailDomains/)
})

test('a $comment inside the map is not an environment', () => {
  const p = { ...base(), environments: { $comment: 'why these exist', dev: {} } }
  assert.deepEqual(envNames(p), ['dev'])
  assert.deepEqual(validate(p), [], 'a comment must not claim a mail domain')
})

test('an env absent from the environments map is refused', () => {
  assert.throws(() => parametersFor(multi(), 'inbox', 'staging'), /not listed/)
})

test('the service is told every domain its environment receives on', () => {
  // So reply() can answer from the domain the customer actually wrote to.
  const p = { ...base(), environments: { dev: { mailDomains: ['a.example', 'b.example'] } } }
  assert.equal(parametersFor(p, 'inbox', 'dev').MailDomains, 'a.example,b.example')
})
