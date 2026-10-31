import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { PoolClient } from 'pg'
import { pool } from './pool'

export type MigrationFile = { name: string; sql: string; checksum: string }
export type MigrationState = 'applied' | 'pending'

const MIGRATION_LOCK_KEY = 723518_001

function migrationsDir(): string {
  const candidates = [
    path.resolve(__dirname, 'migrations'),
    path.resolve(__dirname, '..', '..', 'src', 'db', 'migrations'),
    path.resolve(process.cwd(), 'src', 'db', 'migrations'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`Migration folder not found. Looked in: ${candidates.join(', ')}`)
}

export function readMigrationFiles(): MigrationFile[] {
  const dir = migrationsDir()
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8').replaceAll('\r\n', '\n')
      return { name: file, sql: raw, checksum: crypto.createHash('sha256').update(raw).digest('hex') }
    })
}

async function ensureMigrationsTable(client: PoolClient) {
  await client.query(`
    create table if not exists schema_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )
  `)
}

export async function migrationStatus() {
  const client = await pool.connect()
  try {
    await ensureMigrationsTable(client)
    const { rows } = await client.query<{ name: string; checksum: string; applied_at: Date }>(
      'select name, checksum, applied_at from schema_migrations',
    )
    const applied = new Map(rows.map((row) => [row.name, row]))
    return readMigrationFiles().map((file) => {
      const record = applied.get(file.name)
      return {
        name: file.name,
        state: (record ? 'applied' : 'pending') as MigrationState,
        appliedAt: record?.applied_at ?? null,
        drifted: Boolean(record && record.checksum !== file.checksum),
      }
    })
  } finally {
    client.release()
  }
}

export async function runMigrations(options: { onMessage?: (message: string) => void } = {}) {  const report = options.onMessage ?? (() => undefined)
  const files = readMigrationFiles()
  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    await ensureMigrationsTable(client)
    const { rows } = await client.query<{ name: string; checksum: string }>('select name, checksum from schema_migrations')
    const applied = new Map(rows.map((row) => [row.name, row.checksum]))

    for (const file of files) {
      const previous = applied.get(file.name)
      if (previous) {
        if (previous !== file.checksum) {
          throw new Error(
            `Migration ${file.name} changed after it was applied. Add a new migration instead of editing history.`,
          )
        }
        continue
      }
      report(`applying ${file.name}`)
      await client.query('begin')
      try {
        // Migrations are parameter-free, so a multi-statement simple query is safe.
        await client.query(file.sql)
        await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [file.name, file.checksum])
        await client.query('commit')
      } catch (error) {
        await client.query('rollback').catch(() => undefined)
        throw new Error(`Migration ${file.name} failed: ${(error as Error).message}`)
      }
    }
    report('schema is up to date')
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined)
    client.release()
  }
}

/**
 * The API refuses to serve a schema it cannot trust. Booting into a pending or
 * edited migration would let writes land in tables that no longer match, which
 * is a far worse failure than a refused start.
 */
export async function assertMigrationsCurrent() {
  const status = await migrationStatus()
  const pending = status.filter((entry) => entry.state === 'pending').map((entry) => entry.name)
  const drifted = status.filter((entry) => entry.drifted).map((entry) => entry.name)

  if (pending.length > 0) {
    throw new Error(`Database schema is behind the code. Run \`npm run migrate\` first. Pending: ${pending.join(', ')}`)
  }
  if (drifted.length > 0) {
    throw new Error(`Applied migrations no longer match the files on disk: ${drifted.join(', ')}. Restore the file or add a new migration.`)
  }
}
