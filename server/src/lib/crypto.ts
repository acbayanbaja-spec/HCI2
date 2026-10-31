import crypto from 'node:crypto'
import { argon2id, hash as argonHash, needsRehash, verify as argonVerify, type HashOptions } from 'argon2'
import { env } from '../config/env'

// OWASP-recommended parameters for an interactive login hash.
const ARGON2_OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 65_536, // KiB
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
}

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON2_OPTIONS)
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password)
  } catch {
    // A malformed or foreign hash reads as "did not match", never as a 500.
    return false
  }
}

/** Lets a successful login transparently upgrade older, weaker hashes. */
export function passwordNeedsRehash(hash: string): boolean {
  try {
    return needsRehash(hash, ARGON2_OPTIONS)
  } catch {
    return true
  }
}

/** Opaque, URL-safe random value for refresh tokens and one-time links. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

/**
 * Refresh tokens and emailed links are only ever stored as digests, so a
 * database leak cannot be replayed against the API.
 */
export function digestToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function deriveKey(secret: string, context: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from(context, 'utf8'), 32))
}

// One purpose, one derived key: a leaked email digest cannot be reused as an IP
// digest or a recovery-code digest.
const emailPepper = deriveKey(env.auth.refreshTokenSecret, 'digital-guardian:email-digest')
const ipPepper = deriveKey(env.auth.refreshTokenSecret, 'digital-guardian:ip-digest')
const recoveryPepper = deriveKey(env.auth.accessTokenSecret, 'digital-guardian:recovery-code-digest')

/** Comparable but not reversible identifier, used in the login and audit logs. */
export function digestEmail(email: string): string {
  return crypto.createHmac('sha256', emailPepper).update(email.trim().toLowerCase()).digest('hex')
}

export function digestIp(ip: string): string {
  return crypto.createHmac('sha256', ipPepper).update(ip).digest('hex')
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHmac('sha256', recoveryPepper).update(normalizeRecoveryCode(code)).digest('hex')
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '')
}

const ENCRYPTION_KEY = Buffer.from(env.auth.dataEncryptionKey, 'hex')

export type EncryptedBlob = { ciphertext: Buffer; iv: Buffer; tag: Buffer }

/** AES-256-GCM envelope for secrets at rest, such as a TOTP seed. */
export function encryptSecret(plaintext: string): EncryptedBlob {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { ciphertext, iv, tag: cipher.getAuthTag() }
}

export function decryptSecret(blob: EncryptedBlob): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, blob.iv)
  decipher.setAuthTag(blob.tag)
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]).toString('utf8')
}

/** Timing-safe comparison for caller-supplied codes. */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  if (bufferA.length !== bufferB.length) {
    crypto.timingSafeEqual(bufferA, bufferA)
    return false
  }
  return crypto.timingSafeEqual(bufferA, bufferB)
}
