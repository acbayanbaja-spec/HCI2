#!/usr/bin/env node
/**
 * Dev-only helper that runs a real PostgreSQL server from the prebuilt binaries
 * shipped by @embedded-postgres/*, so the project can be tested end to end on a
 * machine with no PostgreSQL and no Docker installed.
 *
 * Never used in production: production targets Supabase PostgreSQL.
 */
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const requireFromRoot = createRequire(path.join(ROOT, 'package.json'))

const PORT = Number(process.env.DEV_DB_PORT ?? 5543)
const DEV_DIR = path.join(ROOT, '.devdb')
const CLUSTER_DIR = path.join(DEV_DIR, 'data')
const CREDS_FILE = path.join(DEV_DIR, 'credentials.json')
const LOG_FILE = path.join(DEV_DIR, 'postgres.log')

const SUPERUSER = 'postgres'
const APP_USER = 'guardian'
const APP_DB = 'digital_guardian'

function log(message) {
  console.log(`[dev-db] ${message}`)
}

function die(message) {
  console.error(`[dev-db] ${message}`)
  process.exit(1)
}

function binDir() {
  const candidates = [
    `@embedded-postgres/${process.platform}-${process.arch}`,
    process.platform === 'win32' ? '@embedded-postgres/windows-x64' : null,
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      // exports maps "." only, so walk up from the resolved entry point.
      const entry = requireFromRoot.resolve(candidate)
      const pkgDir = path.dirname(path.dirname(entry))
      const dir = path.join(pkgDir, 'native', 'bin')
      if (fs.existsSync(dir)) return dir
    } catch {
      /* try the next candidate */
    }
  }
  die(`PostgreSQL binaries not found for ${process.platform}-${process.arch}`)
}

function exe(name) {
  const bin = process.platform === 'win32' ? `${name}.exe` : name
  const full = path.join(binDir(), bin)
  if (!fs.existsSync(full)) die(`Missing ${bin} in ${binDir()}`)
  return full
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex')
}

function readCreds() {
  if (!fs.existsSync(CREDS_FILE)) return null
  try {
    return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'))
  } catch {
    return null
  }
}

function ensureCreds() {
  const existing = readCreds()
  if (existing) return { ...existing, port: existing.port ?? PORT }
  const creds = {
    port: PORT,
    superuserPassword: randomSecret(12),
    applicationPassword: randomSecret(16),
    createdAt: new Date().toISOString(),
  }
  fs.mkdirSync(DEV_DIR, { recursive: true })
  fs.writeFileSync(CREDS_FILE, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 })
  return creds
}

export function adminUrl(creds, database = 'postgres') {
  return `postgresql://${SUPERUSER}:${encodeURIComponent(creds.superuserPassword)}@127.0.0.1:${creds.port}/${database}`
}

export function appUrl(creds) {
  return `postgresql://${APP_USER}:${encodeURIComponent(creds.applicationPassword)}@127.0.0.1:${creds.port}/${APP_DB}`
}

async function query(url, sql, params = []) {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 4000, ssl: false })
  await client.connect()
  try {
    return await client.query(sql, params)
  } finally {
    await client.end()
  }
}

function tcpOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.setTimeout(1000)
    const finish = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.on('connect', () => finish(true))
    socket.on('error', () => finish(false))
    socket.on('timeout', () => finish(false))
  })
}

async function waitForServer(creds, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await tcpOpen(creds.port)) {
      try {
        await query(adminUrl(creds), 'select 1')
        return
      } catch {
        /* still accepting connections */
      }
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  die(`PostgreSQL did not become ready on 127.0.0.1:${creds.port} - see ${LOG_FILE}`)
}

function isRunning() {
  if (!fs.existsSync(path.join(CLUSTER_DIR, 'postmaster.pid'))) return false
  try {
    execFileSync(exe('pg_ctl'), ['status', '-D', CLUSTER_DIR], { stdio: ['ignore', 'pipe', 'pipe'] })
    return true
  } catch {
    return false
  }
}

function initCluster(creds) {
  const pwFile = path.join(DEV_DIR, '.initpw')
  fs.mkdirSync(DEV_DIR, { recursive: true })
  fs.writeFileSync(pwFile, `${creds.superuserPassword}\n`, { mode: 0o600 })
  log('initialising a fresh PostgreSQL cluster (first run only)')
  try {
    execFileSync(exe('initdb'), ['-D', CLUSTER_DIR, '-U', SUPERUSER, '--pwfile', pwFile, '--auth=scram-sha-256', '--locale=C', '--encoding=UTF8'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  } catch (error) {
    die(`initdb failed: ${error.stderr?.toString() ?? error.message}`)
  } finally {
    fs.rmSync(pwFile, { force: true })
  }
  fs.appendFileSync(path.join(CLUSTER_DIR, 'postgresql.conf'), "\nlisten_addresses = '127.0.0.1'\n")
}

function spawnServer(creds) {
  const out = fs.openSync(LOG_FILE, 'a')
  const child = spawn(exe('postgres'), ['-D', CLUSTER_DIR, '-p', String(creds.port), '-c', 'listen_addresses=127.0.0.1'], {
    detached: true,
    stdio: ['ignore', out, out],
  })
  child.unref()
}

function literal(value) {
  // PostgreSQL rejects bound parameters in utility statements (CREATE/ALTER
  // ROLE), so the secret is embedded as a properly escaped string literal.
  return `'${String(value).replaceAll("'", "''")}'`
}

async function ensureRoleAndDatabase(creds) {
  const url = adminUrl(creds)
  const roles = await query(url, 'SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_USER])
  if (roles.rowCount === 0) {
    await query(url, `CREATE ROLE ${APP_USER} LOGIN PASSWORD ${literal(creds.applicationPassword)}`)
    log(`created role ${APP_USER}`)
  } else {
    await query(url, `ALTER ROLE ${APP_USER} WITH PASSWORD ${literal(creds.applicationPassword)}`)
  }
  const dbs = await query(url, 'SELECT 1 FROM pg_database WHERE datname = $1', [APP_DB])
  if (dbs.rowCount === 0) {
    await query(url, `CREATE DATABASE ${APP_DB} OWNER ${APP_USER}`)
    log(`created database ${APP_DB}`)
  }
}

function writeServerEnv(creds) {
  const envPath = path.join(ROOT, 'server', '.env')
  if (fs.existsSync(envPath)) {
    log('server/.env already exists - left untouched')
    return
  }
  const replacements = {
    DATABASE_URL: appUrl(creds),
    ACCESS_TOKEN_SECRET: randomSecret(32),
    REFRESH_TOKEN_SECRET: randomSecret(32),
    DATA_ENCRYPTION_KEY: randomSecret(32),
  }
  const template = fs.readFileSync(path.join(ROOT, 'server', '.env.example'), 'utf8')
  const filled = template
    .split('\n')
    .map((line) => {
      const key = line.split('=')[0]
      return Object.hasOwn(replacements, key) ? `${key}=${replacements[key]}` : line
    })
    .join('\n')
  fs.writeFileSync(envPath, filled, { mode: 0o600 })
  log('wrote server/.env with freshly generated dev-only secrets')
}

async function start() {
  const creds = ensureCreds()
  if (!fs.existsSync(CLUSTER_DIR)) initCluster(creds)
  if (isRunning()) {
    log(`already running on 127.0.0.1:${creds.port}`)
  } else {
    spawnServer(creds)
  }
  await waitForServer(creds)
  await ensureRoleAndDatabase(creds)
  writeServerEnv(creds)
  log(`ready: ${APP_DB} on 127.0.0.1:${creds.port}`)
  log('server/.env DATABASE_URL points at this cluster (password stays in the file)')
}

function stop() {
  if (!fs.existsSync(CLUSTER_DIR)) {
    log('no cluster to stop')
    return
  }
  execFileSync(exe('pg_ctl'), ['stop', '-D', CLUSTER_DIR, '-m', 'fast'], { stdio: ['ignore', 'pipe', 'pipe'] })
  log('stopped')
}

async function status() {
  const creds = readCreds()
  if (!creds) {
    log('not initialised')
    process.exitCode = 1
    return
  }
  if (!isRunning()) {
    log(`stopped (database ${APP_DB} on 127.0.0.1:${creds.port})`)
    process.exitCode = 1
    return
  }
  const info = await query(adminUrl(creds, APP_DB), 'select current_setting($1) as v, (select count(*) from pg_stat_activity where datname = current_database()) as c', [
    'server_version',
  ])
  log(`running - PostgreSQL ${info.rows[0].v}, ${info.rows[0].c} connections, database ${APP_DB}`)
}

function reset() {
  if (!process.argv.includes('--yes')) die('refusing to delete the local dev cluster without --yes')
  try {
    stop()
  } catch {
    /* already stopped */
  }
  fs.rmSync(CLUSTER_DIR, { recursive: true, force: true })
  fs.rmSync(CREDS_FILE, { force: true })
  log('removed the dev cluster and its credentials')
  log('server/.env still holds the old DATABASE_URL - delete it to regenerate')
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) {
  const command = process.argv[2] ?? 'start'
  switch (command) {
    case 'start':
      await start()
      break
    case 'stop':
      stop()
      break
    case 'status':
      await status()
      break
    case 'reset':
      reset()
      break
    case 'url': {
      const creds = readCreds()
      if (!creds) die('not initialised - run `npm run db:start` first')
      console.log(appUrl(creds))
      break
    }
    case 'secrets':
      console.log(JSON.stringify({ access: randomSecret(32), refresh: randomSecret(32), dataKey: randomSecret(32) }, null, 2))
      break
    default:
      die(`unknown command "${command}" (start | stop | status | reset | url | secrets)`)
  }
}
