import path from 'node:path'
import crypto from 'node:crypto'
import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'
import {
  applyPasswordOverride,
  collectPasswordCandidates,
  normalizeDatabaseUrl,
  resolveDatabaseAuth,
} from '../db/connection-url'

// .env sits next to package.json in both src (tsx) and dist (compiled) layouts.
loadDotenv({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true })

const booleanish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes')

const csvList = z
  .string()
  .transform((value) => value.split(',').map((entry) => entry.trim()).filter(Boolean))

const hexKey = z
  .string()
  .min(64, 'must be 64 hex characters (32 bytes)')
  .refine((value) => /^[0-9a-fA-F]{64}$/.test(value), 'must be 64 hex characters (32 bytes)')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGINS: csvList.default(['http://localhost:5173']),

  DATABASE_URL: z.string().min(12, 'DATABASE_URL is required'),
  DATABASE_PASSWORD: z.string().optional(),
  SUPABASE_PROJECT_REF: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim()
      return trimmed ? trimmed : undefined
    }),
  PGSSL: booleanish.default(false),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),

  ACCESS_TOKEN_SECRET: z.string().min(32, 'must be at least 32 characters'),
  REFRESH_TOKEN_SECRET: z.string().min(32, 'must be at least 32 characters'),
  DATA_ENCRYPTION_KEY: hexKey,

  COOKIE_SECURE: booleanish.default(false),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SAME_SITE: z.enum(['lax', 'none', 'strict']).default('lax'),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(180).default(30),
  MAX_FAILED_LOGINS: z.coerce.number().int().min(3).max(20).default(5),
  ACCOUNT_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(3).max(1000).default(20),
  ANALYZE_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
  ANALYZE_RATE_LIMIT_MAX: z.coerce.number().int().min(3).max(1000).default(30),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Digital Guardian <no-reply@example.com>'),
  APP_CLIENT_URL: z.string().url().default('http://localhost:5173'),
})

type EnvIssues = string[]

function crossFieldIssues(env: z.infer<typeof envSchema>): EnvIssues {
  const issues: EnvIssues = []

  const secrets = [env.ACCESS_TOKEN_SECRET, env.REFRESH_TOKEN_SECRET]
  if (secrets[0] === secrets[1]) {
    issues.push('ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must not be the same value')
  }
  const reused = new Set<string>()
  for (const secret of [...secrets, env.DATA_ENCRYPTION_KEY]) {
    if (reused.has(secret)) issues.push('Every secret must be unique - one value is reused')
    reused.add(secret)
  }

  if (env.COOKIE_SAME_SITE === 'none' && !env.COOKIE_SECURE) {
    issues.push('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true (browsers reject it otherwise)')
  }

  if (env.NODE_ENV === 'production') {
    if (!env.COOKIE_SECURE) issues.push('COOKIE_SECURE must be true in production')
    if (!env.PGSSL) issues.push('PGSSL must be true in production')
    for (const origin of env.CORS_ORIGINS) {
      if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(origin)) {
        issues.push(`CORS_ORIGINS contains a development URL: ${origin}`)
      }
      if (!origin.startsWith('https://')) issues.push(`CORS_ORIGINS must be https in production: ${origin}`)
    }
    if (!env.SMTP_HOST) {
      issues.push('SMTP_HOST is required in production so password resets can be delivered')
    }
  }

  // Guard against template placeholders surviving into a running server.
  // MAIL_FROM is excluded because its display name legitimately uses <angle@brackets>.
  const placeholderKeys = [
    'DATABASE_URL',
    'DATABASE_PASSWORD',
    'ACCESS_TOKEN_SECRET',
    'REFRESH_TOKEN_SECRET',
    'DATA_ENCRYPTION_KEY',
    'APP_CLIENT_URL',
    'SMTP_HOST',
    'SMTP_USER',
    'SMTP_PASSWORD',
  ]
  for (const key of placeholderKeys) {
    const value = process.env[key]
    if (typeof value === 'string' && /change-me|placeholder|your-|<[a-z0-9.-]+>/i.test(value)) {
      issues.push(`${key} still looks like a placeholder value`)
    }
  }

  return issues
}

function buildEnv() {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(
      `Invalid environment configuration.\n${details}\n\n` +
        'Start the local stack with `npm run db:start`, which writes server/.env, ' +
        'or copy server/.env.example and fill it in. Never commit real credentials.',
    )
  }

  const issues = crossFieldIssues(parsed.data)
  if (issues.length > 0) {
    throw new Error(`Invalid environment configuration.\n${issues.map((i) => `  - ${i}`).join('\n')}`)
  }

  const env = parsed.data
  const isProduction = env.NODE_ENV === 'production'
  const isTest = env.NODE_ENV === 'test'
  const fromUri = normalizeDatabaseUrl(env.DATABASE_URL, { projectRef: env.SUPABASE_PROJECT_REF })
  let database = resolveDatabaseAuth(fromUri, env.DATABASE_PASSWORD || process.env.PGPASSWORD)
  const passwordCandidates = collectPasswordCandidates({
    password: database.password,
    encoded: database.passwordEncoded,
    rawUrl: env.DATABASE_URL,
    extra: [fromUri.password, fromUri.passwordEncoded],
  })
  if (passwordCandidates.length === 0) {
    throw new Error(
      'DATABASE_URL / DATABASE_PASSWORD looks like a Supabase API key (JWT or sb_*), not the Postgres database password. Use the Database password from Supabase → Settings → Database.',
    )
  }
  if (!passwordCandidates.includes(database.password)) {
    database = applyPasswordOverride(fromUri, passwordCandidates[0])
  }

  return {
    nodeEnv: env.NODE_ENV,
    isProduction,
    isTest,
    port: env.PORT,
    corsOrigins: env.CORS_ORIGINS,
    clientUrl: env.APP_CLIENT_URL,
    database: {
      url: database.url,
      password: database.password,
      passwordCandidates,
      authFrom: database.passwordSource,
      credentialChars: database.passwordLength,
      dollarInCredential: database.password.includes('$'),
      target: database.target,
      ssl: env.PGSSL,
      poolMax: env.DB_POOL_MAX,
      statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    },
    auth: {
      accessTokenSecret: env.ACCESS_TOKEN_SECRET,
      refreshTokenSecret: env.REFRESH_TOKEN_SECRET,
      dataEncryptionKey: env.DATA_ENCRYPTION_KEY,
      accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      maxFailedLogins: env.MAX_FAILED_LOGINS,
      accountLockMinutes: env.ACCOUNT_LOCK_MINUTES,
    },
    cookies: {
      secure: env.COOKIE_SECURE,
      domain: env.COOKIE_DOMAIN,
      sameSite: env.COOKIE_SAME_SITE,
    },
    limits: {
      authWindowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000,
      authMax: env.AUTH_RATE_LIMIT_MAX,
      analyzeWindowMs: env.ANALYZE_RATE_LIMIT_WINDOW_MINUTES * 60_000,
      analyzeMax: env.ANALYZE_RATE_LIMIT_MAX,
    },
    mail: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.MAIL_FROM,
      transportless: !env.SMTP_HOST,
    },
  } as const
}

export const env = buildEnv()

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}
