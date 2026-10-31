import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

// Enough of a blocklist to stop the obvious, without pretending to be a breach
// corpus. Real breach checking belongs to an external service.
const COMMON_PASSWORDS = new Set([
  'password123',
  'password1234',
  'passw0rd123',
  '123456789012',
  'qwertyuiop12',
  'letmein12345',
  'iloveyou1234',
  'admin1234567',
  'welcome12345',
  'monkey123456',
  'dragon123456',
  'football1234',
  'baseball1234',
  'trustno11234',
  'abc123456789',
  '111111111111',
])

export type PasswordClass = 'lower' | 'upper' | 'digit' | 'symbol'

export type PasswordAssessment = {
  score: 0 | 1 | 2 | 3 | 4
  label: 'very weak' | 'weak' | 'fair' | 'strong' | 'excellent'
  satisfiedRules: string[]
  missingRules: string[]
  /** True only when the password meets the registration policy. */
  acceptable: boolean
}

function characterClasses(value: string): PasswordClass[] {
  const classes: PasswordClass[] = []
  if (/[a-z]/.test(value)) classes.push('lower')
  if (/[A-Z]/.test(value)) classes.push('upper')
  if (/[0-9]/.test(value)) classes.push('digit')
  if (/[^A-Za-z0-9]/.test(value)) classes.push('symbol')
  return classes
}

function isRepeating(value: string): boolean {
  return /^(.)\1+$/.test(value)
}

function isSequential(value: string): boolean {
  const lowered = value.toLowerCase()
  const runs = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiopasdfghjklzxcvbnm']
  return runs.some((run) => run.includes(lowered))
}

/**
 * Explains a password decision the same way the score engine explains a safety
 * score: the user sees which rules were met and which are still missing.
 */
export function assessPassword(value: string, context: { email?: string; displayName?: string } = {}): PasswordAssessment {
  const rules: Array<{ id: string; label: string; ok: boolean }> = [
    { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, ok: value.length >= PASSWORD_MIN_LENGTH },
    { id: 'classes', label: 'Uses three of: lowercase, uppercase, number, symbol', ok: characterClasses(value).length >= 3 },
    { id: 'common', label: 'Not a commonly used password', ok: !COMMON_PASSWORDS.has(value.toLowerCase()) },
    { id: 'patterns', label: 'Not a repeating or keyboard sequence', ok: !isRepeating(value) && !isSequential(value) },
    {
      id: 'personal',
      label: 'Does not contain your name or email address',
      ok: (() => {
        const lowered = value.toLowerCase()
        const localPart = context.email?.split('@')[0]?.toLowerCase() ?? ''
        const name = context.displayName?.toLowerCase().trim() ?? ''
        if (localPart.length >= 4 && lowered.includes(localPart)) return false
        if (name.length >= 4 && lowered.includes(name)) return false
        return true
      })(),
    },
  ]

  const satisfied = rules.filter((rule) => rule.ok)
  const missing = rules.filter((rule) => !rule.ok)
  const lengthBonus = value.length >= 20 ? 1 : 0
  const raw = Math.min(4, Math.max(0, satisfied.length - missing.length + 1 + lengthBonus)) as 0 | 1 | 2 | 3 | 4

  const labels: PasswordAssessment['label'][] = ['very weak', 'weak', 'fair', 'strong', 'excellent']

  return {
    score: raw,
    label: labels[raw] ?? 'weak',
    satisfiedRules: satisfied.map((rule) => rule.label),
    missingRules: missing.map((rule) => rule.label),
    acceptable: rules.filter((rule) => rule.id !== 'patterns').every((rule) => rule.ok),
  }
}

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, 'That password is too long to be practical.')
  .refine((value) => assessPassword(value).acceptable, {
    message: 'That password is too easy to guess. Mix lengths and character types.',
  })

export const emailSchema = z
  .string()
  .trim()
  .min(6, 'Enter a valid email address.')
  .max(254, 'That email address is too long.')
  .email('Enter a valid email address.')
  .transform((value) => value.toLowerCase())
