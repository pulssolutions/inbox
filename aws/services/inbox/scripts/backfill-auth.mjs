#!/usr/bin/env node
// One-off backfill to support email one-time-code login alongside Google.
//
// For the chosen environment's user pool it makes every inbox admin a single,
// canonical native (email) user with email_verified=true, and removes any
// standalone Google_<sub> federated user so it re-links to the native account
// (via the PreSignUp trigger) on the person's next Google sign-in.
//
// Safe to run repeatedly (idempotent). Intended for the few pre-launch dev/www
// users — it lists all admin rows and all Cognito users, no sampling.
//
// Usage:
//   node scripts/backfill-auth.mjs --env dev|www [--pool <UserPoolId>] \
//     [--prefix <name>] [--profile <aws-profile>] [--dry-run]
//
// Region eu-north-1. Profile defaults to `acme`.

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const parseArgs = () => {
  const out = {}
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = process.argv[i + 1]
    if (!next || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i++
    }
  }
  return out
}

const die = (msg) => {
  console.error(msg)
  process.exit(2)
}

const args = parseArgs()
if (!args.env || (args.env !== 'dev' && args.env !== 'www')) {
  die('Required: --env dev|www')
}
const profile = args.profile || process.env.AWS_PROFILE
const region = args.region || 'eu-north-1'
const dryRun = args['dry-run'] === true
// Table name follows the deployment profile's prefix, not a hardcoded one.
const prefix = args.prefix || process.env.INBOX_PREFIX || 'inbox'
const tableName = `${prefix}-inbox-data-${args.env}`

const aws = (awsArgs, { json = false } = {}) => {
  const res = spawnSync(
    'aws',
    ['--profile', profile, '--region', region, '--output', 'json', ...awsArgs],
    { encoding: 'utf8' }
  )
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json }
}

const run = (awsArgs, { allowFail = false } = {}) => {
  const res = aws(awsArgs)
  if (res.status !== 0 && !allowFail) {
    die(`aws ${awsArgs.join(' ')}\n${res.stderr}`)
  }
  return res
}

const randomPassword = () => randomBytes(18).toString('base64').replace(/[+/=]/g, '') + 'Aa1'

// --- resolve the pool id ------------------------------------------------
let poolId = args.pool
if (!poolId) {
  const res = run([
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    `${prefix}-inbox-service-${args.env}`,
    '--query',
    "Stacks[0].Outputs[?OutputKey=='AdminUserPoolId'].OutputValue",
    '--output',
    'text'
  ])
  poolId = res.stdout.trim()
}
if (!poolId || poolId === 'None') die('AdminUserPoolId not found')

// --- collect admin emails from DynamoDB ---------------------------------
const adminEmails = new Set()
let startKey = null
do {
  const scanArgs = [
    'dynamodb',
    'scan',
    '--table-name',
    tableName,
    '--filter-expression',
    'begins_with(gsi1pk, :p)',
    '--expression-attribute-values',
    '{":p":{"S":"admin-email#"}}',
    '--projection-expression',
    'email'
  ]
  if (startKey) scanArgs.push('--exclusive-start-key', JSON.stringify(startKey))
  const res = run(scanArgs)
  const parsed = JSON.parse(res.stdout || '{}')
  for (const item of parsed.Items || []) {
    const email = item.email?.S
    if (email) adminEmails.add(email.toLowerCase())
  }
  startKey = parsed.LastEvaluatedKey || null
} while (startKey)

console.log(`Found ${adminEmails.size} admin email(s) in ${tableName}`)

// --- ensure a verified, confirmed native user for each admin email ------
const ensureNativeUser = (email) => {
  if (dryRun) {
    console.log(`[dry-run] ensure native user ${email} (verified, confirmed)`)
    return
  }
  const create = run(
    [
      'cognito-idp',
      'admin-create-user',
      '--user-pool-id',
      poolId,
      '--username',
      email,
      '--message-action',
      'SUPPRESS',
      '--user-attributes',
      `Name=email,Value=${email}`,
      'Name=email_verified,Value=true'
    ],
    { allowFail: true }
  )
  if (create.status === 0) {
    run([
      'cognito-idp',
      'admin-set-user-password',
      '--user-pool-id',
      poolId,
      '--username',
      email,
      '--password',
      randomPassword(),
      '--permanent'
    ])
    console.log(`created native user ${email}`)
  } else if (/UsernameExistsException/.test(create.stderr)) {
    run([
      'cognito-idp',
      'admin-update-user-attributes',
      '--user-pool-id',
      poolId,
      '--username',
      email,
      '--user-attributes',
      'Name=email_verified,Value=true'
    ])
    console.log(`verified existing user ${email}`)
  } else {
    die(`admin-create-user ${email}\n${create.stderr}`)
  }
}

for (const email of adminEmails) ensureNativeUser(email)

// --- drop standalone Google_ users so they re-link on next login --------
const emailOf = (user) =>
  (user.Attributes || []).find((a) => a.Name === 'email')?.Value?.toLowerCase() || null

let pageToken = null
let deleted = 0
do {
  const listArgs = ['cognito-idp', 'list-users', '--user-pool-id', poolId, '--limit', '60']
  if (pageToken) listArgs.push('--pagination-token', pageToken)
  const res = run(listArgs)
  const parsed = JSON.parse(res.stdout || '{}')
  for (const user of parsed.Users || []) {
    const isFederated = /_/.test(user.Username || '')
    if (!isFederated) continue
    const email = emailOf(user)
    // Only unlink federated users that belong to a managed admin; leave others.
    if (!email || !adminEmails.has(email)) continue
    if (dryRun) {
      console.log(`[dry-run] delete standalone ${user.Username} (${email})`)
    } else {
      run([
        'cognito-idp',
        'admin-delete-user',
        '--user-pool-id',
        poolId,
        '--username',
        user.Username
      ])
      console.log(`deleted standalone federated user ${user.Username} (${email})`)
    }
    deleted++
  }
  pageToken = parsed.PaginationToken || null
} while (pageToken)

console.log(
  `Done (${dryRun ? 'dry-run' : 'applied'}): ${adminEmails.size} admin(s), ${deleted} federated user(s) ${dryRun ? 'to remove' : 'removed'} in pool ${poolId}`
)
