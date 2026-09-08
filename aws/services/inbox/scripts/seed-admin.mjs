#!/usr/bin/env node
// Bootstrap an inbox admin as a Cognito user with a custom:organizationId.
// The pretoken trigger turns that attribute into the org + inbox capability
// claims the API checks — no DynamoDB admin row is needed for auth.
//
// Usage:
//   INBOX_SEED_PASSWORD=... node scripts/seed-admin.mjs \
//     --env dev|www \
//     --org acme \
//     --email name@acme.example \
//     [--pool <UserPoolId>]    # else resolved from the service stack output \
//     [--prefix <name>] [--profile <aws-profile>]
//
// The password is read from $INBOX_SEED_PASSWORD only (never an argv literal).
// Region eu-north-1. Profile defaults to `acme`.

import { spawnSync } from 'node:child_process'

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

const aws = (awsArgs, opts = {}) =>
  spawnSync('aws', ['--profile', profile, '--region', region, ...awsArgs], {
    ...opts
  })

const args = parseArgs()
if (!args.env || !args.org || !args.email) {
  die('Required: --env --org --email   (add --db-only for Google users)')
}
// --db-only: write just the DB membership row (for Google-federated users whose
// Cognito account is auto-created on first login — no password needed).
const dbOnly = args['db-only'] === true
const password = process.env.INBOX_SEED_PASSWORD
if (!dbOnly && !password) {
  die('Set $INBOX_SEED_PASSWORD (or pass --db-only for Google users)')
}

// Resource names follow the deployment profile's prefix, not a hardcoded one.
// Declared here because the Cognito branch below resolves the service stack by it.
const prefix = args.prefix || process.env.INBOX_PREFIX || 'inbox'
const profile = args.profile || process.env.AWS_PROFILE
const region = args.region || 'eu-north-1'
const email = String(args.email).toLowerCase()

if (!dbOnly) {
  let poolId = args.pool
  if (!poolId) {
    const res = aws(
      [
        'cloudformation',
        'describe-stacks',
        '--stack-name',
        `${prefix}-inbox-service-${args.env}`,
        '--query',
        "Stacks[0].Outputs[?OutputKey=='AdminUserPoolId'].OutputValue",
        '--output',
        'text'
      ],
      { encoding: 'utf8' }
    )
    if (res.status !== 0) die('Could not resolve AdminUserPoolId from stack')
    poolId = res.stdout.trim()
  }
  if (!poolId || poolId === 'None') die('AdminUserPoolId not found')

  const create = aws(
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
      'Name=email_verified,Value=true',
      `Name=custom:organizationId,Value=${args.org}`
    ],
    { stdio: 'inherit' }
  )
  if (create.status !== 0) die('admin-create-user failed')

  const setPw = aws(
    [
      'cognito-idp',
      'admin-set-user-password',
      '--user-pool-id',
      poolId,
      '--username',
      email,
      '--password',
      password,
      '--permanent'
    ],
    { stdio: 'inherit' }
  )
  if (setPw.status !== 0) die('admin-set-user-password failed')
}

// Write the DB admin record (source of truth for membership + role/categories).
// Includes the email GSI keys so the pretoken resolves the org. Bootstrap
// admins are superadmins (all categories).
const tableName = `${prefix}-inbox-data-${args.env}`
const item = {
  pk: { S: `${args.org}:admin` },
  sk: { S: email },
  gsi1pk: { S: `admin-email#${email}` },
  gsi1sk: { S: args.org },
  email: { S: email },
  org: { S: args.org },
  name: { S: args.name || email },
  role: { S: 'superadmin' },
  active: { BOOL: true },
  categories: { L: [] },
  addedBy: { S: 'seed-admin.mjs' },
  addedAt: { S: new Date().toISOString() }
}
const put = aws(
  ['dynamodb', 'put-item', '--table-name', tableName, '--item', JSON.stringify(item)],
  { stdio: 'inherit' }
)
if (put.status !== 0) die('dynamodb put-item (admin row) failed')

console.log(
  `Seeded superadmin ${email} (org ${args.org}) in ${tableName}${dbOnly ? ' [db-only]' : ' + Cognito'}`
)
