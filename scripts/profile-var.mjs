#!/usr/bin/env node
// Edit the deployment profile that lives in a GitHub repository variable.
//
// A fork holds its profile in DEPLOY_PROFILE_JSON rather than in a tracked file
// (see load() in profile.mjs), which keeps it out of every merge from upstream -
// at the cost of editing a long JSON blob in a textarea on github.com. This
// fetches it, opens it in $EDITOR, validates the result with exactly the code
// the deploy uses, names what changed, and writes it back.
//
//   node scripts/profile-var.mjs                       # edit in $EDITOR
//   node scripts/profile-var.mjs --print               # just show it
//   node scripts/profile-var.mjs features.webhook=true
//   node scripts/profile-var.mjs --repo owner/repo ops.monthlyBudget=20
//   node scripts/profile-var.mjs --dry-run features.webhook=true
//
// A key=value argument skips the editor, which is what you want from a script
// or when the change is one flag. The value parses as JSON when it can (true,
// 20, ["a"]) and stays a string when it cannot.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validate, envNames } from './profile.mjs'

const VAR = 'DEPLOY_PROFILE_JSON'

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim()

const die = (msg) => {
  console.error(msg)
  process.exit(1)
}

// Sets one dotted path, creating the objects along the way - so a profile that
// has never had a `features` block gains one rather than failing.
export const setPath = (profile, path, value) => {
  const keys = path.split('.')
  const last = keys.pop()
  let node = profile
  for (const key of keys) {
    if (typeof node[key] !== 'object' || node[key] === null || Array.isArray(node[key])) {
      node[key] = {}
    }
    node = node[key]
  }
  node[last] = value
  return profile
}

export const parseValue = (raw) => {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

// Names what moved rather than printing the whole blob back - the point of this
// is that the profile is long. Recurses into plain objects, so a nested change
// reads as its own path instead of two whole subtrees.
export const changes = (a, b, path = '') => {
  const out = []
  for (const key of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const at = path ? `${path}.${key}` : key
    const l = a?.[key]
    const r = b?.[key]
    if (JSON.stringify(l) === JSON.stringify(r)) continue
    const bothPlain =
      l && r && typeof l === 'object' && typeof r === 'object' &&
      !Array.isArray(l) && !Array.isArray(r)
    if (bothPlain) out.push(...changes(l, r, at))
    else out.push(`${at}: ${JSON.stringify(l)} -> ${JSON.stringify(r)}`)
  }
  return out
}

// ---------------------------------------------------------------------- cli
// Same guard profile.mjs uses, so importing the helpers above does not fire a
// gh call.
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())

if (isMain) {
  const args = process.argv.slice(2)
  const flag = (name) => {
    const i = args.indexOf(name)
    return i === -1 ? null : args[i + 1]
  }

  // Default to the checkout you are standing in, which is the repo whose
  // variable you almost certainly mean. gh resolves the remote itself.
  const repoArg = flag('--repo')
  const repo =
    repoArg || sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])

  let current
  try {
    current = JSON.parse(sh('gh', ['variable', 'get', VAR, '--repo', repo]))
  } catch (e) {
    die(`could not read ${VAR} from ${repo}: ${e.message}`)
  }

  if (args.includes('--print')) {
    console.log(JSON.stringify(current, null, 2))
    process.exit(0)
  }

  const assignments = args.filter(
    (a) => !a.startsWith('--') && a.includes('=') && a !== repoArg
  )

  let next
  if (assignments.length) {
    next = structuredClone(current)
    for (const assignment of assignments) {
      const [path, ...rest] = assignment.split('=')
      setPath(next, path, parseValue(rest.join('=')))
    }
  } else {
    const file = join(mkdtempSync(join(tmpdir(), 'profile-')), `${repo.split('/')[1]}.json`)
    writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`)
    const editor = process.env.EDITOR || process.env.VISUAL || 'vi'
    // Inherit the terminal, or the editor has nothing to draw on.
    execFileSync(editor, [file], { stdio: 'inherit' })
    try {
      next = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      die(`not valid JSON, nothing written: ${e.message}`)
    }
  }

  const after = JSON.stringify(next, null, 2)
  if (JSON.stringify(current, null, 2) === after) {
    console.log('unchanged')
    process.exit(0)
  }

  // Checked with the same validate() the deploy runs, so a profile that passes
  // here cannot fail the pipeline for a reason this could have caught.
  const errors = validate(next)
  if (errors.length) die(`invalid profile, nothing written:\n  - ${errors.join('\n  - ')}`)

  console.log(`${repo} ${VAR}:`)
  for (const line of changes(current, next)) console.log(`  ${line}`)
  console.log(`environments: ${envNames(next).join(', ')}`)

  if (args.includes('--dry-run')) {
    console.log('dry run, nothing written')
    process.exit(0)
  }

  sh('gh', ['variable', 'set', VAR, '--repo', repo, '--body', after])
  console.log('written. Re-run the stacks whose parameters this changes.')
}
