import { describe, expect, it } from 'vitest'
import { explainDatabaseError, normalizeDatabaseUrl } from '../src/db/connection-url'

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
    const { url } = normalizeDatabaseUrl('postgresql://postgres.abc:p@ss/w:rd#1@db.abc.supabase.co:5432/postgres')
    expect(url).toContain(encodeURIComponent('p@ss/w:rd#1'))
    expect(url).toContain('@db.abc.supabase.co:5432/postgres')
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

  it('refuses the transaction pooler on 6543', () => {
    expect(() =>
      normalizeDatabaseUrl(
        'postgresql://postgres.abc:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
      ),
    ).toThrow(/6543/)
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
    expect(explained.message).toContain('Session pooler')
  })
})
