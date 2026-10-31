#!/usr/bin/env node
/**
 * One command that answers "is this safe to commit?". It runs the same checks a
 * reviewer would, in the order a failure is cheapest to read: types, then the
 * test suite against a real database, then both production builds.
 *
 * `npm run verify`
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const steps = [
  { name: 'typecheck (server and client)', args: ['run', 'typecheck'] },
  { name: 'tests (unit and API integration)', args: ['run', 'test'] },
  { name: 'build (server and client)', args: ['run', 'build'] },
]

function run(step) {
  process.stdout.write(`\n[verify] ${step.name}\n`)
  // npm is a .cmd file on Windows and Node refuses to spawn one without a shell.
  // cmd.exe mis-parses a command line that starts with a quote, so this stays
  // unquoted: both halves are this file's own constants, never user input.
  const command = [NPM, ...step.args].join(' ')
  const result = spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true })
  if (result.error) throw result.error
  return (result.status ?? 1) === 0
}

if (!fs.existsSync(path.join(ROOT, '.devdb', 'credentials.json'))) {
  console.error('[verify] The local database is not set up yet. Run `npm run db:start` first.')
  process.exit(1)
}

const failed = []
for (const step of steps) {
  if (!run(step)) failed.push(step.name)
}

process.stdout.write('\n')
if (failed.length > 0) {
  console.error(`[verify] failed: ${failed.join(', ')}`)
  console.error('[verify] Nothing here is safe to commit until every step passes.')
  process.exit(1)
}

console.log('[verify] types, tests and builds all pass.')
console.log('[verify] Before deploying, walk the checklist in README.md: register, sign in,')
console.log('         two-step verification, dashboard, analyzer, and a phone-width screen.')
