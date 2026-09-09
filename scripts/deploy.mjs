#!/usr/bin/env node
// Deploy one profile's stacks, in dependency order.
//
//   node scripts/deploy.mjs <profile>              # everything, env dev
//   node scripts/deploy.mjs <profile> --env dev --only inbox-mail
//   node scripts/deploy.mjs <profile> --dry-run    # print commands, change nothing
//
// Everything here exists because the trial run tripped over it:
//
//   - Activating the SES rule set is not a CloudFormation resource, so a stack
//     can deploy perfectly green and still drop every message.
//   - The web app's origin is a CloudFront name that does not exist until the
//     web stack does, and Cognito rejects any redirect_uri it was not told
//     about - so the inbox stack is deployed twice, the second time with the
//     resolved URL.
//   - Nothing may deploy into the wrong account, so the caller's identity is
//     checked against the profile before anything runs.

import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load, parametersFor, derive, envConfig } from './profile.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Order matters. inbox owns the table that parse writes to; parse must exist
// (with its SES grant) before the rule naming it is created.
const ORDER = ['shared', 'inbox', 'inbox-parse', 'inbox-mail', 'certificates', 'web']

const TEMPLATES = {
  account: 'aws/account/template.yml',
  billing: 'aws/billing/template.yml',
  shared: 'aws/shared/template.yml',
  inbox: 'aws/services/inbox/template.yml',
  'inbox-parse': 'aws/services/inbox-parse/template.yml',
  'inbox-mail': 'aws/services/inbox-mail/template.yml',
  certificates: 'aws/certificates/template.yml',
  web: 'aws/web/inbox/template.yml'
}

// CloudFront certificates and Budgets exist only in us-east-1, whatever region
// the profile names.
const REGION_OVERRIDE = { certificates: 'us-east-1', billing: 'us-east-1' }
const regionFor = (stack) => REGION_OVERRIDE[stack] || profile.region

const args = process.argv.slice(2)
const profileName = args[0]
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const has = (name) => args.includes(`--${name}`)

if (!profileName || profileName.startsWith('--')) {
  console.error('usage: deploy.mjs <profile> [--env dev] [--only <stack>] [--dry-run]')
  process.exit(2)
}

const envName = flag('env', 'dev')
const only = flag('only', null)
const dryRun = has('dry-run')

const profile = load(profileName)
const d = derive(profile, envName)
const envCfg = envConfig(profile, envName)

const aws = (args, { capture = true } = {}) =>
  execFileSync('aws', ['--region', profile.region, ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  }).trim()

const say = (msg) => console.log(msg)

// --- account guard ---------------------------------------------------------

const whoami = JSON.parse(aws(['sts', 'get-caller-identity', '--output', 'json']))
if (whoami.Account !== String(profile.accountId)) {
  console.error(
    `refusing to deploy: profile "${profile.name}" targets account ${profile.accountId}, ` +
      `but these credentials are account ${whoami.Account}`
  )
  process.exit(1)
}
say(`profile ${profile.name} -> account ${whoami.Account} (${profile.region}), env ${envName}`)

// --- artifact build --------------------------------------------------------

// account and billing are account-wide one-time bootstrap - an OIDC provider,
// a CloudTrail trail and a budget are not per-environment things, so they carry
// no env suffix.
const ACCOUNT_WIDE = new Set(['account', 'billing'])
const stackName = (s) => {
  const base = s === 'web' ? 'inbox-web' : s === 'inbox' ? 'inbox-service' : s
  return ACCOUNT_WIDE.has(s) ? `${profile.name}-${base}` : `${profile.name}-${base}-${envName}`
}

const stackOutput = (stack, key) => {
  try {
    const out = aws([
      '--region', regionFor(stack),
      'cloudformation', 'describe-stacks',
      '--stack-name', stackName(stack),
      '--query', `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`,
      '--output', 'text'
    ])
    return out === 'None' ? '' : out
  } catch {
    return ''
  }
}

// Read a parameter back off a deployed stack. Used so a partial run (--only web)
// can redeploy the inbox stack for its Cognito callback URL without rebuilding
// and re-uploading Lambda zips that have not changed.
const stackParameter = (stack, key) => {
  try {
    const out = aws([
      'cloudformation', 'describe-stacks',
      '--stack-name', stackName(stack),
      '--query', `Stacks[0].Parameters[?ParameterKey=='${key}'].ParameterValue`,
      '--output', 'text'
    ])
    return out === 'None' ? '' : out
  } catch {
    return ''
  }
}

const existingServiceCode = () => {
  const keys = [
    'LambdaCodeS3Bucket',
    'LambdaCodeS3Key',
    'PretokenLambdaCodeS3Key',
    'PreSignUpLambdaCodeS3Key'
  ]
  const found = Object.fromEntries(keys.map((k) => [k, stackParameter('inbox', k)]))
  return keys.every((k) => found[k]) ? found : null
}

const deployStack = (stack, extra = {}, resolved = {}) => {
  const template = resolve(root, TEMPLATES[stack])
  if (!existsSync(template)) throw new Error(`no template for ${stack}`)
  const params = { ...parametersFor(profile, stack, envName, resolved), ...extra }
  const overrides = Object.entries(params).map(([k, v]) => `${k}=${v}`)

  say(`\n== ${stackName(stack)}`)
  for (const o of overrides) say(`   ${o}`)
  if (dryRun) return

  execFileSync(
    'aws',
    [
      '--region', regionFor(stack),
      'cloudformation', 'deploy',
      '--stack-name', stackName(stack),
      '--template-file', template,
      '--parameter-overrides', ...overrides,
      '--capabilities', 'CAPABILITY_NAMED_IAM',
      '--no-fail-on-empty-changeset'
    ],
    { stdio: 'inherit' }
  )
}

// The service Lambda zips have to exist in the artifact bucket before the
// inbox stack can reference them.
const publishServiceCode = () => {
  const svc = resolve(root, 'aws/services/inbox')
  const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  if (!dryRun) {
    execFileSync('npm', ['run', 'package'], { cwd: svc, stdio: 'inherit' })
    for (const [file, key] of [
      ['inbox-service.zip', `${version}.zip`],
      ['inbox-pretoken.zip', `pretoken-${version}.zip`],
      ['inbox-presignup.zip', `presignup-${version}.zip`]
    ]) {
      aws(['s3', 'cp', resolve(svc, 'dist', file), `s3://${d.artifactBucket}/inbox-service/${key}`, '--only-show-errors'])
    }
  }
  return {
    LambdaCodeS3Bucket: d.artifactBucket,
    LambdaCodeS3Key: `inbox-service/${version}.zip`,
    PretokenLambdaCodeS3Key: `inbox-service/pretoken-${version}.zip`,
    PreSignUpLambdaCodeS3Key: `inbox-service/presignup-${version}.zip`
  }
}

// The web app's API URL and Cognito ids are per-deployment, so they are written
// from the profile and the inbox stack's outputs rather than committed.
// Copy the profile's brand artwork into the web app's public/ so it ships as a
// static asset at a stable path. Nothing company-specific is committed to the
// app; without a configured logo it falls back to its own neutral mark.
const stageBrandAssets = (web) => {
  const dest = resolve(web, 'public/brand')
  // Wipe first. Vite copies everything under public/ verbatim, so deploying a
  // branded profile and then an unbranded one from the same checkout would
  // otherwise publish the first customer's logo at /brand/* on the second
  // customer's site.
  if (!dryRun) rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  if (!dryRun) {
    writeFileSync(
      resolve(dest, '.gitignore'),
      '# Staged from the deployment profile at build time.\n*\n!.gitignore\n'
    )
  }
  const out = {}
  for (const [key, file] of [['logo', 'logo.png'], ['logoDark', 'logo-dark.png']]) {
    const rel = profile.brand?.[key]
    if (!rel) continue
    if (!dryRun) copyFileSync(resolve(root, rel), resolve(dest, file))
    out[key] = `/brand/${file}`
  }
  return out
}

const buildWebApp = () => {
  const web = resolve(root, 'aws/web/inbox')
  const brand = stageBrandAssets(web)
  const env = {
    VITE_API_BASE: stackOutput('inbox', 'InboxApiEndpoint'),
    VITE_COGNITO_DOMAIN: stackOutput('inbox', 'AdminUserPoolDomain'),
    VITE_USER_POOL_ID: stackOutput('inbox', 'AdminUserPoolId'),
    VITE_USER_POOL_CLIENT_ID: stackOutput('inbox', 'AdminUserPoolClientId'),
    VITE_AWS_REGION: profile.region,
    VITE_ENVIRONMENT: envName,
    VITE_BRAND_SHORT: profile.brand?.short || profile.org.name,
    VITE_BRAND_TAGLINE: profile.brand?.tagline || 'Inbox',
    VITE_BRAND_FULL: profile.org.name,
    VITE_BRAND_LOGO: brand.logo || '',
    VITE_BRAND_LOGO_DARK: brand.logoDark || brand.logo || '',
    VITE_APP_TITLE: `${profile.brand?.short || profile.org.name} ${profile.brand?.tagline || 'Inbox'}`
  }
  const body =
    '# Generated by scripts/deploy.mjs from the deployment profile.\n' +
    '# Do not commit - these are per-account values.\n' +
    Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
  say(`\n== web app build`)
  for (const [k, v] of Object.entries(env)) say(`   ${k}=${v}`)
  if (dryRun) return
  // Only meaningful once the inbox stack exists; in a dry run there are no
  // outputs to read yet, which is not an error.
  const missing = ['VITE_API_BASE', 'VITE_USER_POOL_ID', 'VITE_USER_POOL_CLIENT_ID']
    .filter((k) => !env[k])
  if (missing.length) {
    throw new Error(`cannot build the web app - inbox stack outputs missing: ${missing.join(', ')}`)
  }
  writeFileSync(resolve(web, '.env.local'), body)
  execFileSync('yarn', ['install', '--silent'], { cwd: web, stdio: 'inherit' })
  execFileSync('yarn', ['build'], { cwd: web, stdio: 'inherit' })
}

// --- run -------------------------------------------------------------------

if (only && !TEMPLATES[only]) {
  console.error(
    `unknown stack "${only}" (have: ${Object.keys(TEMPLATES).join(', ')})`
  )
  process.exit(2)
}

const wanted = only ? [only] : ORDER
let code = null

for (const stack of wanted) {
  if (stack === 'shared') {
    deployStack('shared')
  } else if (stack === 'inbox') {
    code = publishServiceCode()
    // First pass: the CloudFront name is not known yet, so WebAppUrl is empty.
    deployStack('inbox', code)
  } else if (stack === 'inbox-parse') {
    deployStack('inbox-parse')
  } else if (stack === 'inbox-mail') {
    // The rule set is account-wide and lives in the account stack. Referencing
    // one that does not exist fails deep inside a rollback, so check up front.
    if (!dryRun) {
      try {
        aws(['ses', 'describe-receipt-rule-set', '--rule-set-name', d.ruleSet])
      } catch {
        throw new Error(
          `receipt rule set ${d.ruleSet} does not exist - deploy --only account first`
        )
      }
    }
    deployStack('inbox-mail')
    if (!dryRun) {
      // The step CloudFormation cannot do. Without it, nothing is received.
      aws(['ses', 'set-active-receipt-rule-set', '--rule-set-name', d.ruleSet])
      say(`   activated receipt rule set ${d.ruleSet}`)
    }
  } else if (stack === 'certificates') {
    if (!envCfg.web.domain) {
      say('\n== certificates skipped - no web.domain configured')
    } else {
      deployStack('certificates')
    }
  } else if (stack !== 'web') {
    // account and billing: one-time bootstrap, no ordering or post-steps.
    deployStack(stack)
  } else {
    buildWebApp()
    // CloudFront cannot take the alias without a certificate, and the
    // certificate lives in a us-east-1 stack.
    const certArn = envCfg.web.domain
      ? stackOutput('certificates', 'CloudFrontCertificateArn')
      : ''
    if (envCfg.web.domain && !certArn) {
      throw new Error(
        'web.domain is set but no certificate found - deploy --only certificates first'
      )
    }
    deployStack('web', certArn ? { CloudFrontCertificateArn: certArn } : {})
    if (!dryRun) {
      const cloudfrontDomain = stackOutput('web', 'WebUrl').replace(/^https:\/\//, '')
      const bucket = stackOutput('web', 'WebBucketName')
      const site = resolve(root, 'aws/web/inbox/site')
      if (bucket && existsSync(site)) {
        aws(['s3', 'sync', site, `s3://${bucket}/`, '--delete', '--only-show-errors'])
        say(`   uploaded ${site} -> ${bucket}`)
      } else if (bucket) {
        say(`   nothing to upload - build the app first (cd aws/web/inbox && yarn build)`)
      }
      // Second pass over the inbox stack, now that the origin is known. Cognito
      // will reject logins from any origin it has not been told about, so this
      // must happen even on a partial run - fall back to the code already
      // deployed rather than skipping it.
      code = code || existingServiceCode()
      if (cloudfrontDomain && code) {
        say(`\n== ${stackName('inbox')} (second pass: WebAppUrl=https://${cloudfrontDomain})`)
        deployStack('inbox', code, { cloudfrontDomain })
      }
    }
  }
}

say('\ndone')
