import crypto from 'node:crypto'
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import { env } from '../config/env'
import { logger } from '../lib/logger'

function buildSsl() {
  if (!env.database.ssl) return undefined
  if (process.env.PGSSL_INSECURE === 'true') {
    logger.warn(
      'PGSSL_INSECURE is set, so TLS certificate verification is disabled. Use PGSSL_ROOT_CERT instead when a CA bundle is available.',
    )
    return { rejectUnauthorized: false }
  }

  const pem = process.env.PGSSL_ROOT_CERT ?? ''
  const certificates = (pem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length
  if (pem !== '' && certificates === 0) {
    logger.error(
      'PGSSL_ROOT_CERT is set but holds no PEM certificate, so verification will fall back to the system trust store. It must contain the certificate text, not a file path.',
      { firstCharacters: pem.slice(0, 24) },
    )
  } else if (certificates > 0) {
    try {
      logger.info('Verifying the database certificate against a supplied CA', {
        certificates,
        subject: new crypto.X509Certificate(pem).subject.replace(/\n/g, ', '),
      })
    } catch {
      logger.error('PGSSL_ROOT_CERT contains a PEM block that could not be parsed.', { certificates })
    }
  } else {
    logger.info('PGSSL is on with no PGSSL_ROOT_CERT, so the database CA must be in the system trust store.')
  }

  return { rejectUnauthorized: true, ca: pem || undefined }
}

export const pool = new Pool({
  connectionString: env.database.url,
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

export async function closePool(): Promise<void> {
  await pool.end()
}
