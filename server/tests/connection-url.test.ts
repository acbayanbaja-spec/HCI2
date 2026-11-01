import { describe, expect, it } from 'vitest'
import {
  applyPasswordOverride,
  explainDatabaseError,
  normalizeDatabaseUrl,
  poolConnectionConfig,
  resolveDatabaseAuth,
  sanitizeSecret,
} from '../src/db/connection-url'

describe('normalizeDatabaseUrl', () => {
  it('leaves a local development URL alone', () => {
    const { url, target } = normalizeDatabaseUrl(
      'postgresql://guardian:change-me-local-only@127.0.0.1:5543/digital_guardian',
    )
    expect(target).toMatchObject({
      user: 'guardian',
      host: '127.0.0.1',
      port: '5543',
      database: 'digital_guardian',
      pooler: false,
      rewrittenUser: false,
    })
    expect(url).toContain('guardian:')
  })

  it('strips wrapping quotes from hosted dashboards', () => {
    const { target } = normalizeDatabaseUrl(
      '"postgresql://postgres.abc123:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"',
    )
    expect(target.user).toBe('postgres.abc123')
    expect(target.pooler).toBe(true)
  })

  it('percent-encodes reserved characters in the password', () => {
    const { url, password } = normalizeDatabaseUrl(
      'postgresql://postgres.abc:p@ss/w:rd#1@db.abc.supabase.co:5432/postgres',
    )
    expect(password).toBe('p@ss/w:rd#1')
    expect(url).toContain(encodeURIComponent('p@ss/w:rd#1'))
    expect(url).toContain('@db.abc.supabase.co:5432/postgres')
  })

  it('decodes a percent-encoded URI password for the driver', () => {
    const normalized = normalizeDatabaseUrl(
      'postgresql://postgres.abc:p%40ss%2Fword@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    )
    expect(normalized.password).toBe('p@ss/word')
    expect(poolConnectionConfig(normalized)).toMatchObject({
      user: 'postgres.abc',
      password: 'p@ss/word',
      port: 5432,
      host: 'aws-0-ap-southeast-1.pooler.supabase.com',
    })
  })

  it('lets DATABASE_PASSWORD replace a mangled URI password', () => {
    const normalized = applyPasswordOverride(
      normalizeDatabaseUrl(
        'postgresql://postgres.abc:wrong@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
      ),
      'raw p@ss',
    )
    expect(normalized.password).toBe('raw p@ss')
    expect(normalized.passwordSource).toBe('DATABASE_PASSWORD')
    expect(poolConnectionConfig(normalized).password).toBe('raw p@ss')
  })

  it('decodes %XX in the URI without treating a lone percent as encoding', () => {
    const { password } = normalizeDatabaseUrl(
      'postgresql://postgres.abc:100%fun%40x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    )
    expect(password).toBe('100%fun@x')
  })

  it('refuses a URI with no password', () => {
    expect(() =>
      normalizeDatabaseUrl('postgresql://postgres.abc@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'),
    ).toThrow(/missing a password/)
  })

  it('requires DATABASE_PASSWORD for the production pooler', () => {
    const normalized = normalizeDatabaseUrl(
      'postgresql://postgres.abc:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    )
    expect(() => resolveDatabaseAuth(normalized, undefined, { production: true })).toThrow(/DATABASE_PASSWORD is required/)
    expect(resolveDatabaseAuth(normalized, ' secret\n', { production: true }).password).toBe('secret')
  })

  it('strips quotes and newlines from a pasted secret', () => {
    expect(sanitizeSecret('"abc"')).toBe('abc')
    expect(sanitizeSecret('abc\r\n')).toBe('abc')
  })

  it('rewrites pooler user postgres when a project ref is supplied', () => {
    const { target, url } = normalizeDatabaseUrl(
      'postgresql://postgres:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
      { projectRef: 'abcdefghijkl' },
    )
    expect(target.user).toBe('postgres.abcdefghijkl')
    expect(target.rewrittenUser).toBe(true)
    expect(url).toContain('postgres.abcdefghijkl')
  })

  it('refuses a pooler URI that still uses user postgres with no project ref', () => {
    expect(() =>
      normalizeDatabaseUrl('postgresql://postgres:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'),
    ).toThrow(/postgres\.<project-ref>/)
  })

  it('rewrites the transaction pooler on 6543 to session mode on 5432', () => {
    const { target, url } = normalizeDatabaseUrl(
      'postgresql://postgres.abc:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
    )
    expect(target.port).toBe('5432')
    expect(url).toContain(':5432/')
    expect(url).not.toContain(':6543/')
  })
})

describe('explainDatabaseError', () => {
  it('names the user and host when Postgres rejects the password', () => {
    const explained = explainDatabaseError(new Error('password authentication failed for user "postgres"'), {
      user: 'postgres.abc',
      host: 'aws-0-ap-southeast-1.pooler.supabase.com',
      port: '5432',
      database: 'postgres',
      pooler: true,
      rewrittenUser: true,
    })
    expect(explained.message).toContain('postgres.abc')
    expect(explained.message).toContain('rejected the password')
    expect(explained.message).toContain('DATABASE_PASSWORD')
    expect(explained.message).not.toContain('not postgres')
  })
})
