#!/usr/bin/env node
// Expand a deployment profile into CloudFormation parameter overrides.
//
//   node scripts/profile.mjs <profile> <stack> [env]        -> Key=Value lines
//   node scripts/profile.mjs <profile> --stacks             -> deployable stacks
//   node scripts/profile.mjs <profile> --check              -> validate only
//
// The point of this file: a value that can be COMPUTED is never a value a
// human types twice. Bucket names, table names, ARNs and function names are all
// derived here from name + accountId + region + env, so no parameter file ever
// contains a pasted AWS account id again.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------- validation

const REQUIRED = [
  'name',
  'accountId',
  'region',
  'mailDomain',
  'notificationEmail',
  'org.slug',
  'org.name',
  'github.owner',
  'github.repo'
]

// SES email receiving is only offered in some regions. Sending works anywhere,
// so a wrong region here fails late and confusingly (mail silently bounces)
// unless we catch it up front.
const SES_RECEIVING_REGIONS = new Set([
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'eu-north-1',
  'eu-south-1',
  'ap-northeast-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-south-1',
  'ca-central-1',
  'il-central-1',
  'me-south-1',
  'sa-east-1'
])

const at = (obj, path) =>
  path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)

const isBlank = (v) => v === undefined || v === null || String(v).trim() === ''

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

// ------------------------------------------------------------- environments
//
// `environments` maps a name to that environment's overrides - its own web
// hostname, its own inbound mail domains. Anything it does not override comes
// from the top level, so a single-environment profile is `{ "dev": {} }`.
//
// It was once a list of names. That form cannot survive the rule that no two
// environments may claim the same mail domain: with nothing to override the
// single top-level mailDomain with, a list is only ever valid with exactly one
// entry. It is rejected with a hint rather than quietly accepted.

const overridesFor = (p) => (p.environments && !Array.isArray(p.environments) ? p.environments : {})

export const envNames = (p) => {
  if (Array.isArray(p.environments)) return p.environments
  // $-prefixed keys are comments, as everywhere else in a profile. Without
  // this, "$comment" is an environment - and one claiming a mail domain.
  if (p.environments) return Object.keys(p.environments).filter((k) => !k.startsWith('$'))
  return ['dev']
}

export const envConfig = (p, env = 'dev') => {
  const o = overridesFor(p)[env] || {}
  return {
    // Absent means "inherit the profile's one domain". An explicit value -
    // including an empty list - is taken literally, so a mistake is caught by
    // validation rather than silently replaced by the default.
    mailDomains:
      o.mailDomains === undefined
        ? [p.mailDomain].filter((d) => !isBlank(d))
        : [].concat(o.mailDomains).filter((d) => !isBlank(d)),
    mail: { hostedZoneId: o.mail?.hostedZoneId ?? p.mail?.hostedZoneId ?? '' },
    web: {
      domain: o.web?.domain ?? p.web?.domain ?? '',
      hostedZoneId: o.web?.hostedZoneId ?? p.web?.hostedZoneId ?? ''
    },
    api: { hostedZoneId: o.api?.hostedZoneId ?? p.api?.hostedZoneId ?? '' },
    senderLocalPart: o.senderLocalPart || p.senderLocalPart || 'support'
  }
}

export const validate = (p) => {
  const errors = []
  for (const key of REQUIRED) {
    if (isBlank(at(p, key))) errors.push(`missing required field: ${key}`)
  }
  if (!isBlank(p.name) && !/^[a-z][a-z0-9-]{1,20}$/.test(p.name)) {
    errors.push(`name must be lowercase kebab, 2-21 chars (got "${p.name}")`)
  }
  if (!isBlank(p.accountId) && !/^\d{12}$/.test(String(p.accountId))) {
    errors.push(`accountId must be 12 digits (got "${p.accountId}")`)
  }
  if (!isBlank(p.region) && !SES_RECEIVING_REGIONS.has(p.region)) {
    errors.push(
      `region ${p.region} does not support SES email receiving - inbound mail would bounce`
    )
  }
  if (!isBlank(p.org?.slug) && !/^[a-z][a-z0-9-]*$/.test(p.org.slug)) {
    errors.push(`org.slug must be lowercase kebab (got "${p.org.slug}")`)
  }
  // A web domain without a hosted zone is legal (records added by hand), but a
  // zone without a domain is always a mistake.
  if (isBlank(p.web?.domain) && !isBlank(p.web?.hostedZoneId)) {
    errors.push('web.hostedZoneId set but web.domain is empty')
  }
  // A Route53 zone id is the switch for stack-managed mail DNS. Catch the
  // shape mistake here rather than as a CloudFormation error 30 seconds in.
  const zone = p.mail?.hostedZoneId
  if (!isBlank(zone) && !/^Z[A-Z0-9]+$/.test(String(zone))) {
    errors.push(`mail.hostedZoneId must be a Route53 zone id (got "${zone}")`)
  }
  // Brand artwork is optional, but a path that does not resolve would fail at
  // deploy time with a confusing copy error, and a dark logo without a light
  // one leaves light mode with no artwork at all.
  for (const key of ['logo', 'logoDark']) {
    const rel = p.brand?.[key]
    if (!isBlank(rel) && !existsSync(resolve(root, rel))) {
      errors.push(`brand.${key} does not exist: ${rel}`)
    }
  }
  if (isBlank(p.brand?.logo) && !isBlank(p.brand?.logoDark)) {
    errors.push('brand.logoDark is set but brand.logo is not')
  }
  // Google needs both halves or neither; one alone silently disables the IdP.
  const gid = p.auth?.google?.clientId
  const gsecret = p.auth?.google?.secretSsm
  if (isBlank(gid) !== isBlank(gsecret)) {
    errors.push('auth.google.clientId and auth.google.secretSsm must be set together')
  }
  // Every environment shares ONE SES receipt rule set (see derive.ruleSet), so
  // a domain claimed by two of them is not a duplicate to tidy up later: SES
  // matches the first rule and the other environment never sees the mail.
  if (Array.isArray(p.environments)) {
    errors.push(
      'environments must be a map of name -> overrides, not a list ' +
        `(write {"${p.environments[0] || 'dev'}": {}} instead)`
    )
  }
  const claimedBy = new Map()
  for (const env of envNames(p)) {
    const c = envConfig(p, env)
    if (!c.mailDomains.length) {
      errors.push(`environments.${env}.mailDomains is empty - it would receive nothing`)
    }
    for (const domain of c.mailDomains) {
      if (!DOMAIN.test(domain)) {
        errors.push(`environments.${env}.mailDomains contains "${domain}", which is not a domain`)
        continue
      }
      if (claimedBy.has(domain)) {
        errors.push(
          `mail domain ${domain} is claimed by more than one environment ` +
            `(${claimedBy.get(domain)} and ${env})`
        )
      } else {
        claimedBy.set(domain, env)
      }
    }
    if (isBlank(c.web.domain) && !isBlank(c.web.hostedZoneId)) {
      errors.push(`environments.${env}.web.hostedZoneId set but that environment has no web.domain`)
    }
  }
  return errors
}

// ------------------------------------------------------------------- derived

// Everything below is computed, never configured. Changing a naming convention
// means changing it here once.
export const derive = (p, env) => {
  const c = envConfig(p, env)
  // The domain this environment sends and verifies as. Extra inbound domains
  // are received but never sent from, so one of them has to be the identity.
  const primaryMailDomain = c.mailDomains[0] || p.mailDomain
  return {
    mailBucket: `${p.name}-inbox-mail-${env}-${p.accountId}-${p.region}`,
    webBucket: `${p.name}-inbox-web-${env}-${p.accountId}`,
    artifactBucket: `${p.name}-artifacts-${env}-${p.accountId}-${p.region}`,
    table: `${p.name}-inbox-data-${env}`,
    parseFunction: `${p.name}-inbox-parse-${env}`,
    // Account-wide, deliberately: SES keeps exactly one ACTIVE receipt rule
    // set per account per region, so a rule set per environment would mean
    // only one environment could ever receive mail. One set, one rule each.
    ruleSet: `${p.name}-inbox`,
    ruleName: `${p.name}-inbox-${env}`,
    mailDomains: c.mailDomains,
    primaryMailDomain,
    sesIdentityArn: `arn:aws:ses:${p.region}:${p.accountId}:identity/${primaryMailDomain}`,
    senderEmail: `${c.senderLocalPart}@${primaryMailDomain}`,
    deployRoleArn: `arn:aws:iam::${p.accountId}:role/${p.name}-github-actions-deploy`
  }
}

// The web app's real origin. A custom domain wins; otherwise the CloudFront
// distribution's own name, which only exists after that stack is created - so
// this is empty on the first pass and filled on the second. Cognito rejects any
// redirect_uri it has not been told about, so this must end up exact.
export const webAppUrl = (p, resolved, env = 'dev') => {
  const domain = envConfig(p, env).web.domain
  if (!isBlank(domain)) return `https://${domain}`
  return resolved?.cloudfrontDomain ? `https://${resolved.cloudfrontDomain}` : ''
}

// ------------------------------------------------------------------- mapping

const STACKS = {
  account: (p) => ({
    ProjectPrefix: p.name,
    GitHubOwner: p.github.owner,
    GitHubRepository: p.github.repo
  }),

  billing: (p) => ({
    ProjectPrefix: p.name,
    NotificationEmail: p.notificationEmail,
    MonthlyBudgetAmount: String(p.ops?.monthlyBudget ?? 10)
  }),

  shared: (p, env) => ({
    ProjectPrefix: p.name,
    Environment: env
  }),

  'inbox-mail': (p, env, d) => ({
    ProjectPrefix: p.name,
    Environment: env,
    // Every domain this environment answers for. The rule set is shared, so
    // this list is also what keeps one environment's mail out of the other's.
    RecipientDomains: d.mailDomains.join(','),
    ReceiptRuleSetName: d.ruleSet,
    RuleName: d.ruleName,
    InboundObjectExpiryDays: String(p.ops?.mailRetentionDays ?? 1825),
    MailHostedZoneId: envConfig(p, env).mail.hostedZoneId,
    ParseFunctionArn: `arn:aws:lambda:${p.region}:${p.accountId}:function:${d.parseFunction}`
  }),

  'inbox-parse': (p, env, d, r) => ({
    ProjectPrefix: p.name,
    Environment: env,
    NotificationEmail: p.notificationEmail || '',
    LogRetentionDays: String(p.ops?.logRetentionDays ?? 14),
    InboxTableName: d.table,
    BucketName: d.mailBucket,
    SenderEmail: d.senderEmail,
    NotifySenderName: `${p.brand?.short || p.org.name} ${p.brand?.tagline || 'Inbox'}`,
    Locale: p.locale || 'en',
    WebBaseUrl: webAppUrl(p, r, env)
  }),

  inbox: (p, env, d, r) => ({
    ProjectPrefix: p.name,
    Environment: env,
    SenderEmail: d.senderEmail,
    SenderName: p.org.name,
    NotifySenderName: `${p.brand?.short || p.org.name} ${p.brand?.tagline || 'Inbox'}`,
    Locale: p.locale || 'en',
    LogRetentionDays: String(p.ops?.logRetentionDays ?? 14),
    // Only used to derive callback URLs when WebAppUrl is empty - i.e. on the
    // first pass, before the CloudFront name exists. Must still be a real
    // domain, because Cognito validates the URLs it is given.
    RootDomainName: envConfig(p, env).web.domain || d.primaryMailDomain,
    SesSourceArn: d.sesIdentityArn,
    MailBucketName: d.mailBucket,
    GoogleClientId: p.auth?.google?.clientId || '',
    GoogleClientSecretSsmName: p.auth?.google?.secretSsm || '',
    WebAppUrl: webAppUrl(p, r, env),
    // Deliberately NOT web.hostedZoneId: the API hostname is derived from
    // RootDomainName (the parent domain), so a delegated child zone would not
    // cover it and ACM validation would hang there until the stack rolled back.
    // Opt in explicitly, with a zone that really contains the API hostname.
    ApiHostedZoneId: envConfig(p, env).api.hostedZoneId
  }),

  certificates: (p, env) => ({
    ProjectPrefix: p.name,
    CertificateName: 'inbox',
    Environment: env,
    HostedZoneId: envConfig(p, env).web.hostedZoneId,
    WebDomainName: envConfig(p, env).web.domain,
    AdditionalDomainName: ''
  }),

  web: (p, env) => ({
    ProjectPrefix: p.name,
    Environment: env,
    DomainName: envConfig(p, env).web.domain,
    HostedZoneId: envConfig(p, env).web.hostedZoneId
  })
}

// ---------------------------------------------------------------------- api

// A profile comes from one of three places, in this order:
//
//   1. $DEPLOY_PROFILE_JSON  - the whole profile as JSON
//   2. a path to a file
//   3. deployments/<name>.json
//
// (1) exists for forks. A fork that had to EDIT a tracked file to configure
// itself would conflict on every merge from upstream; holding its profile in a
// GitHub repository variable gives it no tracked configuration at all, while
// still being validated by exactly the same code as a committed one.
export const load = (nameOrPath) => {
  const inline = process.env.DEPLOY_PROFILE_JSON
  if (inline && String(inline).trim()) {
    let parsed
    try {
      parsed = JSON.parse(inline)
    } catch (e) {
      throw new Error(`DEPLOY_PROFILE_JSON is not valid JSON: ${e.message}`)
    }
    // Named a profile that is not the one the variable holds? That is a
    // misconfiguration worth failing on rather than silently ignoring one.
    if (nameOrPath && parsed.name && nameOrPath !== parsed.name && !existsSync(nameOrPath)) {
      throw new Error(
        `asked for profile "${nameOrPath}" but DEPLOY_PROFILE_JSON holds "${parsed.name}"`
      )
    }
    return parsed
  }

  const file = existsSync(nameOrPath)
    ? nameOrPath
    : resolve(root, 'deployments', `${nameOrPath}.json`)
  if (!existsSync(file)) throw new Error(`no such profile: ${file}`)
  return JSON.parse(readFileSync(file, 'utf8'))
}

export const parametersFor = (profile, stack, env = 'dev', resolved = {}) => {
  const errors = validate(profile)
  if (errors.length) {
    throw new Error(`invalid profile:\n  - ${errors.join('\n  - ')}`)
  }
  const build = STACKS[stack]
  if (!build) {
    throw new Error(`unknown stack "${stack}" (have: ${Object.keys(STACKS).join(', ')})`)
  }
  if (!envNames(profile).includes(env)) {
    throw new Error(`env "${env}" not listed in profile.environments`)
  }
  return build(profile, env, derive(profile, env), resolved)
}

// ---------------------------------------------------------------------- cli

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const [, , profileName, stack, env = 'dev'] = process.argv
  if (!profileName) {
    console.error('usage: profile.mjs <profile> <stack|--stacks|--check|--role|--region> [env]')
    process.exit(2)
  }
  try {
    const profile = load(profileName)
    if (stack === '--role') {
      // The deploy role ARN, for a CI job that must assume it before it can
      // read anything else.
      console.log(derive(profile, env).deployRoleArn)
    } else if (stack === '--region') {
      console.log(profile.region)
    } else if (stack === '--stacks') {
      console.log(Object.keys(STACKS).join('\n'))
    } else if (stack === '--check' || !stack) {
      const errors = validate(profile)
      if (errors.length) {
        console.error(`invalid profile:\n  - ${errors.join('\n  - ')}`)
        process.exit(1)
      }
      console.log(`profile ${profile.name} is valid`)
    } else {
      const params = parametersFor(profile, stack, env, {
        cloudfrontDomain: process.env.CLOUDFRONT_DOMAIN || ''
      })
      for (const [k, v] of Object.entries(params)) console.log(`${k}=${v}`)
    }
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
