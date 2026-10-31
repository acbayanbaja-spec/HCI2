import { generateSecret, generateURI, verifySync } from 'otplib'
import crypto from 'node:crypto'

const ISSUER = 'Digital Guardian'
// RFC 6238 recommends accepting at most one step in each direction.
const EPOCH_TOLERANCE_SECONDS = 30

export type MfaChallenge = { secret: string; otpauthUri: string; manualCode: string }

/**
 * Creates the enrolment challenge. The secret stays server-side (encrypted at
 * rest) and is only ever shown to the user as an otpauth URI / manual code.
 */
export function createMfaChallenge(accountLabel: string): MfaChallenge {
  const secret = generateSecret({ length: 20 })
  return {
    secret,
    otpauthUri: generateURI({ issuer: ISSUER, label: accountLabel, secret }),
    manualCode: secret,
  }
}

export function verifyTotp(secret: string, code: string): boolean {
  const normalized = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalized)) return false
  try {
    return verifySync({ secret, token: normalized, epochTolerance: EPOCH_TOLERANCE_SECONDS }).valid === true
  } catch {
    return false
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Human-readable single-use codes; stored only as HMAC digests. */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = []
  const seen = new Set<string>()
  while (codes.length < count) {
    // Ten symbols from a 32-character alphabet: 50 bits, with no I, O, 0 or 1
    // for a code someone may have to read out loud or type from paper.
    const raw = crypto.randomBytes(10)
    const body = Array.from(raw, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
    const code = `${body.slice(0, 5)}-${body.slice(5, 10)}`
    if (seen.has(code)) continue
    seen.add(code)
    codes.push(code)
  }
  return codes
}
