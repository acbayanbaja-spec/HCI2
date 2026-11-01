import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import { env } from '../config/env'
import { logger } from '../lib/logger'
import { poolConnectionConfig } from './connection-url'

const PEM_MARKER = '-----BEGIN CERTIFICATE-----'

// A path is accepted as well as the PEM text because pasting a 23-line
// certificate into a hosting dashboard is where deployments keep failing.
// Relative paths are tried from the working directory, this package and the
// repository root, because npm runs workspace scripts with the package as cwd.
function loadRootCert(value: string): { pem?: string; source: string } {
  if (value.includes(PEM_MARKER)) return { pem: value, source: 'PGSSL_ROOT_CERT value' }
  const candidates = [
    path.resolve(value),
    path.resolve(__dirname, '..', '..', value),
    path.resolve(__dirname, '..', '..', '..', value),
  ]
  for (const candidate of candidates) {
    try {
      const contents = fs.readFileSync(candidate, 'utf8')
      return contents.includes(PEM_MARKER) ? { pem: contents, source: candidate } : { source: `${candidate} has no PEM` }
    } catch {
      // Try the next candidate.
    }
  }
  return { source: `${candidates.join(' and ')} could not be read` }
}

function buildSsl() {
  if (!env.database.ssl) return undefined
  if (process.env.PGSSL_INSECURE === 'true') {
    logger.warn(
      'PGSSL_INSECURE is set, so TLS certificate verification is disabled. Use PGSSL_ROOT_CERT instead when a CA bundle is available.',
    )
    return { rejectUnauthorized: false }
  }

  const configured = process.env.PGSSL_ROOT_CERT ?? ''
  if (configured === '') {
    logger.info('PGSSL is on with no PGSSL_ROOT_CERT, so the database CA must be in the system trust store.')
    return { rejectUnauthorized: true }
  }

  const { pem, source } = loadRootCert(configured)
  if (!pem) {
    logger.error('PGSSL_ROOT_CERT could not be used, so verification falls back to the system trust store.', { source })
    return { rejectUnauthorized: true }
  }

  const certificates = (pem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length
  try {
    logger.info('Verifying the database certificate against a supplied CA', {
      certificates,
      source,
      subject: new crypto.X509Certificate(pem).subject.replace(/\n/g, ', '),
    })
  } catch {
    logger.warn('The supplied CA is not a parsable X.509 certificate, so Node will decide what to do with it.', {
      certificates,
      source,
    })
  }

  return { rejectUnauthorized: true, ca: pem }
}

logger.info('Database target', {
  user: env.database.target.user,
  host: env.database.target.host,
  port: env.database.target.port,
  database: env.database.target.database,
  rewrittenUser: env.database.target.rewrittenUser,
})

export const pool = new Pool({
  ...poolConnectionConfig({ password: env.database.password, target: env.database.target }),
  max: env.database.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: buildSsl(),
  application_name: 'digital-guardian-api',
  // Asked for at connect time rather than with a follow-up query, so a bound
  // statement can never start on a connection whose limit is not set yet.
  options: `-c statement_timeout=${env.database.statementTimeoutMs}`,
})

pool.on('error', (error) => {
  logger.error('Unexpected error on an idle database connection', { error })
})

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
  return pool.query<T>(text, params)
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await pool.query<T>(text, params)
  return result.rows[0]
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function ping(): Promise<boolean> {
  try {
    await pool.query('select 1')
    return true
  } catch {
    return false
  }
}

function isTransientAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /password authentication failed|circuit breaker open/i.test(message)
}

/** Supavisor can reject a correct password for a few seconds after a rotation. */
export async function waitForDatabase(attempts = 4): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('select 1')
      return
    } catch (error) {
      lastError = error
      if (!isTransientAuthFailure(error) || attempt === attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
    }
  }
  throw lastError
}

export async function closePool(): Promise<void> {
  await pool.end()
}
