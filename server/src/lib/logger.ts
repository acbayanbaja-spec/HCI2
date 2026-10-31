import { env } from '../config/env'

type Level = 'debug' | 'info' | 'warn' | 'error'

// Anything matching these is never written to a log line or sink.
const REDACTED_KEYS = [
  'password',
  'currentpassword',
  'newpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'otp',
  'code',
  'recoverycode',
  'mfa',
  'email',
  'connectionstring',
  'databaseurl',
  'ip',
]

const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+\.[\w.-]+/g

function redactValue(key: string, value: unknown): unknown {
  if (REDACTED_KEYS.some((blocked) => key.toLowerCase().includes(blocked))) return '[redacted]'
  if (typeof value === 'string') return value.replace(EMAIL_IN_TEXT, '[redacted-email]')
  return value
}

function sanitize(input: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (Array.isArray(input)) return input.map((item) => sanitize(item, depth + 1))
  if (input instanceof Error) {
    return { name: input.name, message: input.message, stack: input.stack?.split('\n').slice(0, 4).join('\n') }
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) out[key] = redactValue(key, sanitize(value, depth + 1))
    return out
  }
  return input
}

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  const record: Record<string, unknown> = { level, time: new Date().toISOString(), message }
  if (meta) record.meta = sanitize(meta)
  // Tests stay quiet, except for real faults: a silent 500 is the one thing a
  // suite must never hide.
  const line = env.isTest && level !== 'error' ? null : `${JSON.stringify(record)}\n`
  if (line) {
    if (level === 'error') process.stderr.write(line)
    else process.stdout.write(line)
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (!env.isProduction) emit('debug', message, meta)
  },
  info: (message: string, meta?: Record<string, unknown>) => emit('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit('error', message, meta),
  sanitize,
}
