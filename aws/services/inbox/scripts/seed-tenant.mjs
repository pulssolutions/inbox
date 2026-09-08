#!/usr/bin/env node
// Seed a tenant row (domain -> org) into the inbox table.
//
// Usage:
//   node scripts/seed-tenant.mjs \
//     --env dev|www \
//     --domain acme.example \
//     --org acme \
//     [--name "Acme BK"] \
//     [--prefix <name>] [--profile <aws-profile>]
//
// Prefix defaults to $INBOX_PREFIX; profile defaults to $AWS_PROFILE.

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

const args = parseArgs()
if (!args.env || !args.domain || !args.org) {
  die('Required: --env --domain --org')
}

// Table name follows the deployment profile's prefix, not a hardcoded one.
const prefix = args.prefix || process.env.INBOX_PREFIX || 'inbox'
const tableName = `${prefix}-inbox-data-${args.env}`
const domain = String(args.domain).toLowerCase()

const item = {
  pk: { S: 'ALL:tenant' },
  sk: { S: domain },
  domain: { S: domain },
  org: { S: args.org },
  name: { S: args.name || args.org }
}

const profile = args.profile || process.env.AWS_PROFILE
const region = args.region || 'eu-north-1'

const result = spawnSync(
  'aws',
  [
    '--profile',
    profile,
    '--region',
    region,
    'dynamodb',
    'put-item',
    '--table-name',
    tableName,
    '--item',
    JSON.stringify(item)
  ],
  { stdio: 'inherit' }
)

if (result.status !== 0) {
  die(`aws dynamodb put-item failed with status ${result.status}`)
}

console.log(`Seeded tenant ${domain} -> ${args.org} in ${tableName}`)
