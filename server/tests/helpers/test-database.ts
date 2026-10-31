import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

/**
 * Integration tests run against a real PostgreSQL, never a mock: a mocked query
 * proves the test file works, not that the product does.
 *
 * The cluster is the same development one started by `npm run db:start`, but the
 * tests use their own database so they can reset it without touching dev data.
 */
export const TEST_DATABASE = 'digital_guardian_test'

type Credentials = { port: number; superuserPassword: string; applicationPassword: string }

function connectionUrl(user: string, password: string, port: number, database: string): string {
  return `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`
}

function findServerRoot(): string {
  let dir = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    if (fs.existsSync(path.join(dir, 'src', 'db', 'migrations'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('Could not locate the server package. Run the tests from the repository root or server folder.')
}

/** Absolute path of the `server` package, used for outbox and env lookups. */
export const serverRoot = findServerRoot()

function readCredentials(repoRoot: string): Credentials {
  const file = path.join(repoRoot, '.devdb', 'credentials.json')
  if (!fs.existsSync(file)) {
    throw new Error('Integration tests need the local database. Run `npm run db:start` in the repository root first.')
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Credentials>
  if (typeof raw.port !== 'number' || typeof raw.superuserPassword !== 'string' || typeof raw.applicationPassword !== 'string') {
    throw new Error(`${file} is missing the development credentials. Run \`npm run db:start\` again.`)
  }
  return { port: raw.port, superuserPassword: raw.superuserPassword, applicationPassword: raw.applicationPassword }
}

async function withClient(connectionString: string, work: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, ssl: false })
  await client.connect()
  try {
    await work(client)
  } finally {
    await client.end()
  }
}

/**
 * Must be called before anything under `src/` is imported, because
 * `config/env.ts` snapshots `process.env` the first time it loads.
 */
export async function prepareTestDatabase(): Promise<string> {
  const creds = readCredentials(path.resolve(serverRoot, '..'))

  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = connectionUrl('guardian', creds.applicationPassword, creds.port, TEST_DATABASE)
  process.env.CORS_ORIGINS = 'http://localhost:5173'
  process.env.APP_CLIENT_URL = 'http://localhost:5173'
  process.env.COOKIE_SECURE = 'false'
  process.env.COOKIE_SAME_SITE = 'lax'
  // Rate limits are tested on their own; the suite must not trip them by accident.
  process.env.AUTH_RATE_LIMIT_MAX = '1000'
  process.env.ANALYZE_RATE_LIMIT_MAX = '1000'
  process.env.MAX_FAILED_LOGINS = '3'
  process.env.ACCOUNT_LOCK_MINUTES = '5'
  process.env.SMTP_HOST = ''

  const adminUrl = connectionUrl('postgres', creds.superuserPassword, creds.port, 'postgres')
  await withClient(adminUrl, async (client) => {
    const existing = await client.query('select 1 from pg_database where datname = $1', [TEST_DATABASE])
    if (existing.rowCount === 0) {
      // Utility statements cannot take bound parameters, so the name is a constant.
      await client.query(`create database ${TEST_DATABASE} owner guardian`)
    }
  })

  // Reset from the test database itself: dropping schema public there can never
  // reach the development database.
  await withClient(process.env.DATABASE_URL, async (client) => {
    await client.query('drop schema if exists public cascade')
    await client.query('create schema public')
  })

  const { runMigrations } = await import('../../src/db/migrate.js')
  await runMigrations()

  return process.env.DATABASE_URL
}

export async function closeTestDatabase(): Promise<void> {
  const { closePool } = await import('../../src/db/pool.js')
  await closePool()
}
