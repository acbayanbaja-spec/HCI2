export type GuidanceRule = { id: string; label: string; ok: boolean }

const SEQUENTIAL_RUNS = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiopasdfghjklzxcvbnm']

function classes(value: string): number {
  let count = 0
  if (/[a-z]/.test(value)) count++
  if (/[A-Z]/.test(value)) count++
  if (/[0-9]/.test(value)) count++
  if (/[^A-Za-z0-9]/.test(value)) count++
  return count
}

/**
 * Guidance only. The server runs the same rules plus a common-password list and
 * always has the final say, so this can never promise acceptance.
 */
export function passwordGuidance(value: string, context: { email?: string; displayName?: string }, minLength: number): GuidanceRule[] {
  const lowered = value.toLowerCase()
  const localPart = context.email?.split('@')[0]?.toLowerCase() ?? ''
  const name = context.displayName?.toLowerCase().trim() ?? ''

  return [
    { id: 'length', label: `At least ${minLength} characters`, ok: value.length >= minLength },
    { id: 'classes', label: 'Uses three of: lowercase, uppercase, number, symbol', ok: classes(value) >= 3 },
    {
      id: 'patterns',
      label: 'Not a repeating or keyboard sequence',
      ok: value.length > 0 && !/^(.)\1+$/.test(value) && !SEQUENTIAL_RUNS.some((run) => run.includes(lowered)),
    },
    {
      id: 'personal',
      label: 'Does not contain your name or email address',
      ok: value.length > 0 && !((localPart.length >= 4 && lowered.includes(localPart)) || (name.length >= 4 && lowered.includes(name))),
    },
  ]
}
