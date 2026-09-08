#!/usr/bin/env node
// Package the Lambda zips:
//  - dist/inbox-service.zip    (main API Lambda: src/ + production node_modules)
//  - dist/inbox-pretoken.zip   (pretoken trigger: pretoken/src/ only — no deps)
//  - dist/inbox-presignup.zip  (presignup trigger: presignup/src/ only — no deps)

import { execSync } from 'node:child_process'
import { rmSync, mkdirSync, existsSync, cpSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const dist = resolve(root, 'dist')

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

// --- main service ---
const stage = resolve(dist, 'stage-service')
mkdirSync(stage, { recursive: true })
cpSync(resolve(root, 'src'), stage, { recursive: true })
cpSync(resolve(root, 'package.json'), resolve(stage, 'package.json'))
// Carry the registry pin into the staging dir, or the install there falls back
// to whatever registry the developer's global npmrc points at.
if (existsSync(resolve(root, '.npmrc'))) {
  cpSync(resolve(root, '.npmrc'), resolve(stage, '.npmrc'))
}
execSync('npm install --omit=dev --ignore-scripts --no-audit --no-fund', {
  cwd: stage,
  stdio: 'inherit'
})
if (!existsSync(resolve(stage, 'node_modules'))) {
  throw new Error('node_modules missing after install')
}
const serviceZip = resolve(dist, 'inbox-service.zip')
execSync(`cd "${stage}" && zip -rq "${serviceZip}" .`, { stdio: 'inherit' })
console.log(`Packaged: ${serviceZip}`)

// --- pretoken (no deps) ---
const pretokenZip = resolve(dist, 'inbox-pretoken.zip')
execSync(`cd "${resolve(root, 'pretoken/src')}" && zip -rq "${pretokenZip}" .`, {
  stdio: 'inherit'
})
console.log(`Packaged: ${pretokenZip}`)

// --- presignup (no deps; AWS SDK v3 is in the Lambda runtime) ---
const presignupZip = resolve(dist, 'inbox-presignup.zip')
execSync(`cd "${resolve(root, 'presignup/src')}" && zip -rq "${presignupZip}" .`, {
  stdio: 'inherit'
})
console.log(`Packaged: ${presignupZip}`)
