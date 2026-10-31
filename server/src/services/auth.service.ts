import { AppError } from '../lib/errors'
import { env } from '../config/env'
import {
  constantTimeEqual,
  decryptSecret,
  digestEmail,
  digestIp,
  digestToken,
  encryptSecret,
  hashPassword,
  hashRecoveryCode,
  passwordNeedsRehash,
  randomToken,
  verifyPassword,
} from '../lib/crypto'
import { createMfaChallenge, generateRecoveryCodes, verifyTotp } from '../lib/mfa'
import { assessPassword } from '../lib/password-policy'
import { logger } from '../lib/logger'
import { query, queryOne, transaction } from '../db/pool'
import { recordSecurityEvent } from './audit.service'
import { createNotification } from './notification.service'
import { passwordResetEmail, sendEmail, verificationEmail } from './mail.service'
import { refreshAssessment } from './recommendation.service'
import { createSession, findActiveSession, revokeAllSessions, revokeSession, verifyPendingSession } from './session.service'
import { signAccessToken } from '../lib/tokens'
import type { DeviceInfo } from '../lib/http'

export type PublicUser = {
  id: string
  email: string
  displayName: string
  role: 'user' | 'admin'
  status: string
  emailVerified: boolean
  mfaEnabled: boolean
  lastLoginAt: Date | null
  createdAt: Date
}

type UserRow = {
  id: string
  email: string
  password_hash: string
  display_name: string
  role_key: 'user' | 'admin'
  status: string
  email_verified_at: Date | null
  mfa_enabled: boolean
  mfa_secret_ciphertext: Buffer | null
  mfa_secret_iv: Buffer | null
  mfa_secret_tag: Buffer | null
  failed_login_attempts: number
  locked_until: Date | null
  last_login_at: Date | null
  created_at: Date
}

const SELECT_USER = `select id, email, password_hash, display_name, role_key, status, email_verified_at,
       mfa_enabled, mfa_secret_ciphertext, mfa_secret_iv, mfa_secret_tag,
       failed_login_attempts, locked_until, last_login_at, created_at
  from users where deleted_at is null and id = $1`

const SELECT_USER_BY_EMAIL = SELECT_USER.replace('id = $1', 'email_normalized = $1')

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role_key,
    status: row.status,
    emailVerified: Boolean(row.email_verified_at),
    mfaEnabled: row.mfa_enabled,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  }
}

// A real hash is verified even when the address is unknown, so a response time
// difference cannot be used to discover which emails are registered.
let dummyHashPromise: Promise<string> | null = null
async function dummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(`decoy-${randomToken(12)}`)
  return dummyHashPromise
}

export type LoginOutcome =
  | { kind: 'success'; user: PublicUser; accessToken: string; refreshToken: string; sessionId: string }
  | { kind: 'mfa_required'; sessionId: string; displayName: string }
  | { kind: 'locked'; lockedUntil: Date; retryAfterSeconds: number }
  | { kind: 'invalid' }

export type LoginContext = { device: DeviceInfo; userAgent: string; ip: string | null }

/** A sign-in waiting on its second factor should not linger for 30 days. */
const PROVISIONAL_SESSION_TTL_MS = 5 * 60 * 1000

export async function registerUser(input: { email: string; password: string; displayName: string; context: LoginContext }) {
  const email = input.email.trim().toLowerCase()
  const assessment = assessPassword(input.password, { email, displayName: input.displayName })
  if (!assessment.acceptable) {
    throw AppError.badRequest('That password is not strong enough yet.', { missingRules: assessment.missingRules })
  }

  const existing = await queryOne<{ id: string }>('select id from users where email_normalized = $1 and deleted_at is null', [email])
  if (existing) {
    throw AppError.conflict('That email address already has a Digital Guardian account.')
  }

  const passwordHash = await hashPassword(input.password)

  const user = await queryOne<Omit<UserRow, 'mfa_secret_ciphertext' | 'mfa_secret_iv' | 'mfa_secret_tag'>>(
    `insert into users (email, password_hash, display_name, role_key, status)
     values ($1, $2, $3, 'user', 'pending_verification')
     returning id, email, password_hash, display_name, role_key, status, email_verified_at,
              mfa_enabled, failed_login_attempts, locked_until, last_login_at, created_at`,
    [email, passwordHash, input.displayName.trim()],
  )
  if (!user) throw new AppError(500, 'internal_error', 'The account could not be created.')

  await query(
    `insert into user_profiles (user_id) values ($1) on conflict (user_id) do nothing`,
    [user.id],
  )
  await query(`insert into user_preferences (user_id) values ($1) on conflict (user_id) do nothing`, [user.id])

  const verification = await issueVerificationToken(user.id, input.context.ip)

  await recordSecurityEvent({
    userId: user.id,
    actorType: 'user',
    category: 'authentication',
    eventType: 'account_registered',
    message: 'A new Digital Guardian account was created.',
    ipHash: input.context.ip ? digestIp(input.context.ip) : null,
  })

  await sendEmail({ to: user.email, ...verificationEmail(user.display_name, verification.link) }).catch((error) => {
    // Registration must still succeed if the confirmation mail cannot be sent.
    logger.error('Could not send the verification email', { error })
  })

  await refreshAssessment(user.id, 'signup')

  return { user: toPublic({ ...user, mfa_secret_ciphertext: null, mfa_secret_iv: null, mfa_secret_tag: null }), verificationRequired: !env.mail.transportless }
}

async function issueVerificationToken(userId: string, ip: string | null) {
  const token = randomToken(32)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await query(
    `insert into auth_tokens (user_id, purpose, token_hash, requested_ip_hash, expires_at)
     values ($1, 'email_verification', $2, $3, $4)`,
    [userId, digestToken(token), ip ? digestIp(ip) : null, expiresAt],
  )
  return { token, link: `${env.clientUrl}/verify-email?token=${token}` }
}

export async function verifyEmailToken(token: string) {
  const row = await queryOne<{ id: string; user_id: string; expires_at: Date; consumed_at: Date | null }>(
    `select id, user_id, expires_at, consumed_at from auth_tokens where purpose = 'email_verification' and token_hash = $1`,
    [digestToken(token)],
  )
  if (!row || row.consumed_at || row.expires_at.getTime() < Date.now()) {
    throw AppError.badRequest('That confirmation link is not valid any more. Request a new one.')
  }

  await query(`update auth_tokens set consumed_at = now() where id = $1`, [row.id])
  const user = await queryOne<{ id: string; display_name: string }>(
    `update users set email_verified_at = now(), status = case when status = 'pending_verification' then 'active' else status end
      where id = $1 and email_verified_at is null returning id, display_name`,
    [row.user_id],
  )
  if (!user) throw AppError.conflict('This email address is already confirmed.')

  await recordSecurityEvent({
    userId: user.id,
    category: 'profile',
    eventType: 'email_verified',
    message: 'The email address on this account was confirmed.',
  })

  await refreshAssessment(user.id, 'mfa_updated')
  return { verified: true }
}

export async function requestNewVerificationEmail(userId: string, ip: string | null) {
  const verification = await issueVerificationToken(userId, ip)
  const user = await queryOne<{ email: string; display_name: string }>('select email, display_name from users where id = $1', [userId])
  if (!user) throw AppError.notFound()

  await sendEmail({ to: user.email, ...verificationEmail(user.display_name, verification.link) })
  return { sent: true }
}

async function recordLoginAttempt(input: {
  emailHash: string | null
  ip: string | null
  userId: string | null
  outcome: 'success' | 'invalid_credentials' | 'unknown_email' | 'mfa_required' | 'mfa_failed' | 'locked' | 'rate_limited' | 'logout'
  userAgent: string
}) {
  await query(
    `insert into login_attempts (email_hash, ip_hash, user_id, outcome, user_agent)
     values ($1, $2, $3, $4, $5)`,
    [input.emailHash, input.ip ? digestIp(input.ip) : null, input.userId, input.outcome, input.userAgent.slice(0, 300)],
  )
}

export async function loginUser(input: { email: string; password: string; context: LoginContext }): Promise<LoginOutcome> {
  const email = input.email.trim().toLowerCase()
  const emailHash = digestEmail(email)
  const ipHash = input.context.ip ? digestIp(input.context.ip) : null

  const row = await queryOne<UserRow>(SELECT_USER_BY_EMAIL, [email])

  if (!row) {
    await verifyPassword(await dummyHash(), input.password)
    await recordLoginAttempt({ emailHash, ip: input.context.ip, userId: null, outcome: 'unknown_email', userAgent: input.context.userAgent })
    return { kind: 'invalid' }
  }

  if (row.status === 'suspended') {
    await recordLoginAttempt({ emailHash, ip: input.context.ip, userId: row.id, outcome: 'locked', userAgent: input.context.userAgent })
    throw AppError.forbidden('This account is suspended. Contact an administrator.')
  }

  if (row.locked_until && row.locked_until.getTime() > Date.now()) {
    await recordLoginAttempt({ emailHash, ip: input.context.ip, userId: row.id, outcome: 'locked', userAgent: input.context.userAgent })
    const retryAfterSeconds = Math.ceil((row.locked_until.getTime() - Date.now()) / 1000)
    return { kind: 'locked', lockedUntil: row.locked_until, retryAfterSeconds }
  }

  const ok = await verifyPassword(row.password_hash, input.password)

  if (!ok) {
    const attempts = row.failed_login_attempts + 1
    const shouldLock = attempts >= env.auth.maxFailedLogins
    await query(
      `update users
          set failed_login_attempts = $2,
              locked_until = case when $3 then now() + ($4 || ' minutes')::interval else null end,
              status = case when $3 and status = 'active' then 'locked' else status end
        where id = $1`,
      [row.id, attempts, shouldLock, String(env.auth.accountLockMinutes)],
    )
    await recordLoginAttempt({ emailHash, ip: input.context.ip, userId: row.id, outcome: 'invalid_credentials', userAgent: input.context.userAgent })

    if (shouldLock) {
      const lockedUntil = new Date(Date.now() + env.auth.accountLockMinutes * 60_000)
      await createNotification({
        userId: row.id,
        kind: 'security_alert',
        severity: 'warning',
        title: 'Sign-ins paused after repeated failures',
        body: `${attempts} failed attempts in a row. Sign-in is paused for ${env.auth.accountLockMinutes} minutes. If this was not you, change your password once the pause ends.`,
        link: '/settings/security',
        dedupeKey: `lockout:${lockedUntil.toISOString().slice(0, 13)}`,
      })
      await recordSecurityEvent({
        userId: row.id,
        category: 'authentication',
        eventType: 'account_locked',
        severity: 'warning',
        message: `Sign-in locked for ${env.auth.accountLockMinutes} minutes after ${attempts} failed attempts.`,
        ipHash,
      })
      return { kind: 'locked', lockedUntil, retryAfterSeconds: env.auth.accountLockMinutes * 60 }
    }
    return { kind: 'invalid' }
  }

  if (passwordNeedsRehash(row.password_hash)) {
    const updated = await hashPassword(input.password)
    await query('update users set password_hash = $2 where id = $1', [row.id, updated])
    logger.info('Upgraded a password hash to current parameters', { userId: row.id })
  }

  if (row.locked_until || row.failed_login_attempts > 0) {
    await query(`update users set failed_login_attempts = 0, locked_until = null, status = case when status = 'locked' and email_verified_at is not null then 'active' else status end where id = $1`, [row.id])
  }

  // mfa_verified records that a second factor was actually proven, never that one
  // was skipped: an account without MFA is unprotected, not verified. When MFA is
  // required the session is provisional and no token is issued until the code checks out.
  const issued = await createSession({
    userId: row.id,
    device: input.context.device,
    userAgent: input.context.userAgent,
    ipHash,
    authMethod: row.mfa_enabled ? 'password_mfa' : 'password',
    mfaVerified: false,
    ttlMs: row.mfa_enabled ? PROVISIONAL_SESSION_TTL_MS : undefined,
  })

  const user = toPublic(row)

  if (row.mfa_enabled) {
    await recordLoginAttempt({ emailHash, ip: input.context.ip, userId: row.id, outcome: 'mfa_required', userAgent: input.context.userAgent })
    await recordSecurityEvent({
      userId: row.id,
      category: 'authentication',
      eventType: 'mfa_challenge_issued',
      message: `Password accepted for ${input.context.device.label}; a verification code is now required.`,
      ipHash,
    })
    return { kind: 'mfa_required', sessionId: issued.sessionId, displayName: user.displayName }
  }

  return finalizeLogin({ row, user, issued, context: input.context, emailHash, mfaMethod: 'password' })
}

async function finalizeLogin(input: {
  row: UserRow
  user: PublicUser
  issued: { sessionId: string; refreshToken: string }
  context: LoginContext
  emailHash: string
  mfaMethod: 'password' | 'password_mfa' | 'recovery_code'
}): Promise<LoginOutcome> {
  const { row, issued, context } = input
  const mfaVerified = row.mfa_enabled && input.mfaMethod !== 'password'

  const accessToken = signAccessToken({ userId: row.id, sessionId: issued.sessionId, role: row.role_key, mfaVerified })

  await query('update users set last_login_at = now() where id = $1', [row.id])
  await recordLoginAttempt({
    emailHash: input.emailHash,
    ip: context.ip,
    userId: row.id,
    outcome: 'success',
    userAgent: context.userAgent,
  })
  await recordSecurityEvent({
    userId: row.id,
    category: 'authentication',
    eventType: 'login_succeeded',
    message: `Signed in from ${context.device.label}.`,
    ipHash: context.ip ? digestIp(context.ip) : null,
    metadata: { sessionId: issued.sessionId, mfa: mfaVerified },
  })

  // A new device or a new place is the one thing a user should always hear about.
  const previousSessions = await queryOne<{ count: string }>(
    `select count(distinct coalesce(browser, '') || '|' || coalesce(os, ''))::text as count
       from auth_sessions
      where user_id = $1 and id <> $2`,
    [row.id, issued.sessionId],
  )
  const isNewDevice = Number(previousSessions?.count ?? 0) === 0
  if (isNewDevice) {
    await createNotification({
      userId: row.id,
      kind: 'security_alert',
      severity: 'caution',
      title: 'A new device signed in',
      body: `${context.device.label} just signed in to Digital Guardian. If that was not you, change your password and end that session.`,
      link: '/settings/security',
      dedupeKey: `new-device:${issued.sessionId}`,
    })
  }

  return { kind: 'success', user: input.user, accessToken, refreshToken: issued.refreshToken, sessionId: issued.sessionId }
}

function readMfaSecret(row: UserRow): string | null {
  if (!row.mfa_secret_ciphertext || !row.mfa_secret_iv || !row.mfa_secret_tag) return null
  try {
    return decryptSecret({
      ciphertext: row.mfa_secret_ciphertext,
      iv: row.mfa_secret_iv,
      tag: row.mfa_secret_tag,
    })
  } catch {
    // A tampered or key-rotated blob must fail closed.
    logger.error('Could not decrypt an MFA secret', { userId: row.id })
    return null
  }
}

export async function completeMfaLogin(input: { sessionId: string; code: string; context: LoginContext }): Promise<LoginOutcome> {
  const session = await findActiveSession(input.sessionId)
  if (!session) throw AppError.unauthorized('That sign-in request expired. Start again.')

  const row = await queryOne<UserRow>(SELECT_USER, [session.user_id])
  if (!row) throw AppError.unauthorized()

  const secret = readMfaSecret(row)
  if (!secret) {
    await revokeSession(row.id, input.sessionId, 'manual')
    throw new AppError(401, 'token_invalid', 'Two-step verification is no longer set up on this account.')
  }

  const code = input.code.replace(/\s/g, '')
  const totpOk = verifyTotp(secret, code)
  const emailHash = digestEmail(row.email)

  if (!totpOk) {
    const looksLikeRecoveryCode = /^([A-Z0-9]{5})-?([A-Z0-9]{5})$/i.test(code)
    const consumed = looksLikeRecoveryCode
      ? await queryOne<{ id: string }>(
          `update mfa_recovery_codes set used_at = now()
            where user_id = $1 and code_hash = $2 and used_at is null
            returning id`,
          [row.id, hashRecoveryCode(code)],
        )
      : null

    if (!consumed) {
      await query('update users set failed_login_attempts = failed_login_attempts + 1 where id = $1', [row.id])
      await recordLoginAttempt({
        emailHash,
        ip: input.context.ip,
        userId: row.id,
        outcome: 'mfa_failed',
        userAgent: input.context.userAgent,
      })
      await recordSecurityEvent({
        userId: row.id,
        category: 'mfa',
        eventType: 'mfa_failed',
        severity: 'caution',
        message: 'An incorrect verification code was entered.',
        ipHash: input.context.ip ? digestIp(input.context.ip) : null,
      })
      throw AppError.unauthorized('That code is not right. Try the current six-digit code from your app.')
    }

    const issued = await verifyPendingSession(input.sessionId, 'recovery_code')
    await createNotification({
      userId: row.id,
      kind: 'security_alert',
      severity: 'warning',
      title: 'A recovery code was used to sign in',
      body: 'One of your single-use recovery codes signed you in. If you did not do this, disable two-step verification and change your password.',
      link: '/settings/security',
      dedupeKey: `recovery-used:${issued.sessionId}`,
    })
    await recordSecurityEvent({
      userId: row.id,
      category: 'mfa',
      eventType: 'recovery_code_used',
      severity: 'warning',
      message: 'Signed in with a single-use recovery code.',
      ipHash: input.context.ip ? digestIp(input.context.ip) : null,
    })
    await query('update users set failed_login_attempts = 0, locked_until = null where id = $1', [row.id])

    return finalizeLogin({
      row,
      user: toPublic(row),
      issued,
      context: input.context,
      emailHash,
      mfaMethod: 'recovery_code',
    })
  }

  const issued = await verifyPendingSession(input.sessionId, 'password_mfa')
  await query(`update users set failed_login_attempts = 0, locked_until = null where id = $1`, [row.id])

  return finalizeLogin({
    row,
    user: toPublic(row),
    issued,
    context: input.context,
    emailHash,
    mfaMethod: 'password_mfa',
  })
}

export async function beginMfaSetup(userId: string) {
  const user = await queryOne<{ email: string; display_name: string; mfa_enabled: boolean }>(
    'select email, display_name, mfa_enabled from users where id = $1',
    [userId],
  )
  if (!user) throw AppError.notFound()
  if (user.mfa_enabled) throw AppError.conflict('Two-step verification is already switched on.')

  const challenge = createMfaChallenge(user.email)
  const encrypted = encryptSecret(challenge.secret)

  await query(
    `update users set mfa_secret_ciphertext = $2, mfa_secret_iv = $3, mfa_secret_tag = $4, mfa_enrolled_at = now()
      where id = $1`,
    [userId, encrypted.ciphertext, encrypted.iv, encrypted.tag],
  )

  await recordSecurityEvent({
    userId,
    category: 'mfa',
    eventType: 'mfa_setup_started',
    message: 'Two-step verification setup started.',
  })

  // The secret is shown exactly once, during enrolment, and only to its owner.
  return {
    otpauthUri: challenge.otpauthUri,
    manualCode: challenge.manualCode,
    accountLabel: user.email,
    issuer: 'Digital Guardian',
    steps: [
      'Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or Aegis).',
      'Scan the QR code, or choose to enter the code manually.',
      'Type the six-digit code it shows to confirm the setup.',
    ],
  }
}

export async function confirmMfaSetup(userId: string, code: string) {
  const row = await queryOne<UserRow>(SELECT_USER, [userId])
  if (!row) throw AppError.notFound()
  if (row.mfa_enabled) throw AppError.conflict('Two-step verification is already switched on.')

  const secret = readMfaSecret(row)
  if (!secret) throw AppError.conflict('Start the setup again - there is no pending code to confirm.')

  if (!verifyTotp(secret, code)) {
    throw AppError.badRequest('That code did not match. Codes change every 30 seconds, so try the current one.')
  }

  const codes = generateRecoveryCodes(10)
  await transaction(async (client) => {
    await client.query('update users set mfa_enabled = true, mfa_enabled_at = now() where id = $1', [userId])
    await client.query('delete from mfa_recovery_codes where user_id = $1', [userId])
    for (const code2 of codes) {
      await client.query('insert into mfa_recovery_codes (user_id, code_hash) values ($1, $2)', [userId, hashRecoveryCode(code2)])
    }
  })

  await createNotification({
    userId,
    kind: 'security_alert',
    severity: 'info',
    title: 'Two-step verification is on',
    body: 'Your authenticator app is now required to sign in. Keep the recovery codes somewhere safe and offline.',
    link: '/settings/security',
    dedupeKey: 'mfa-enabled',
  })
  await recordSecurityEvent({
    userId,
    category: 'mfa',
    eventType: 'mfa_enabled',
    message: 'Two-step verification was switched on for this account.',
  })
  await refreshAssessment(userId, 'mfa_updated')

  return { enabled: true, recoveryCodes: codes }
}

export async function disableMfa(userId: string, input: { password: string; code: string }) {
  const row = await queryOne<UserRow>(SELECT_USER, [userId])
  if (!row) throw AppError.notFound()
  if (!row.mfa_enabled) throw AppError.conflict('Two-step verification is not switched on.')

  const passwordOk = await verifyPassword(row.password_hash, input.password)
  const secret = readMfaSecret(row)
  if (!passwordOk || !secret || !verifyTotp(secret, input.code)) {
    throw AppError.unauthorized('Confirm your password and current code to switch two-step verification off.')
  }

  await query(
    `update users
        set mfa_enabled = false, mfa_secret_ciphertext = null, mfa_secret_iv = null, mfa_secret_tag = null,
            mfa_enrolled_at = null, mfa_enabled_at = null
      where id = $1`,
    [userId],
  )
  await query('delete from mfa_recovery_codes where user_id = $1', [userId])
  await revokeAllSessions(userId, 'mfa_changed', undefined)

  await createNotification({
    userId,
    kind: 'security_alert',
    severity: 'warning',
    title: 'Two-step verification was switched off',
    body: 'All sessions were signed out. If you did not do this yourself, change your password immediately.',
    link: '/settings/security',
    dedupeKey: 'mfa-disabled',
  })
  await recordSecurityEvent({
    userId,
    category: 'mfa',
    eventType: 'mfa_disabled',
    severity: 'warning',
    message: 'Two-step verification was switched off and every session ended.',
  })
  await refreshAssessment(userId, 'mfa_updated')

  return { enabled: false }
}

export async function regenerateRecoveryCodes(userId: string) {
  const row = await queryOne<UserRow>(SELECT_USER, [userId])
  if (!row || !row.mfa_enabled) throw AppError.conflict('Two-step verification must be on first.')

  const codes = generateRecoveryCodes(10)
  await transaction(async (client) => {
    await client.query('delete from mfa_recovery_codes where user_id = $1', [userId])
    for (const code of codes) {
      await client.query('insert into mfa_recovery_codes (user_id, code_hash) values ($1, $2)', [userId, hashRecoveryCode(code)])
    }
  })

  await recordSecurityEvent({
    userId,
    category: 'mfa',
    eventType: 'recovery_codes_rotated',
    severity: 'caution',
    message: 'A new set of recovery codes was generated; the previous set no longer works.',
  })

  return { recoveryCodes: codes }
}

export async function changePassword(input: {
  userId: string
  currentPassword: string
  newPassword: string
  sessionId: string | null
}) {
  const row = await queryOne<UserRow>(SELECT_USER, [input.userId])
  if (!row) throw AppError.notFound()

  const ok = await verifyPassword(row.password_hash, input.currentPassword)
  if (!ok) throw AppError.unauthorized('Your current password is not correct.')

  const assessment = assessPassword(input.newPassword, { email: row.email, displayName: row.display_name })
  if (!assessment.acceptable) {
    throw AppError.badRequest('The new password is not strong enough yet.', { missingRules: assessment.missingRules })
  }
  if (constantTimeEqual(input.currentPassword, input.newPassword)) {
    throw AppError.badRequest('Choose a password you have not used here before.')
  }

  const hash = await hashPassword(input.newPassword)
  await query('update users set password_hash = $2 where id = $1', [input.userId, hash])

  const revoked = await revokeAllSessions(input.userId, 'password_changed', input.sessionId ?? undefined)

  await createNotification({
    userId: input.userId,
    kind: 'security_alert',
    severity: 'caution',
    title: 'Your password was changed',
    body: `${revoked} other session(s) were signed out. If you did not make this change, use the forgotten-password flow now.`,
    link: '/settings/security',
    dedupeKey: `password-changed:${Date.now()}`,
  })
  await recordSecurityEvent({
    userId: input.userId,
    category: 'authentication',
    eventType: 'password_changed',
    severity: 'caution',
    message: 'The account password was changed and other sessions were ended.',
    metadata: { revokedSessions: revoked },
  })

  return { revokedSessions: revoked }
}

/**
 * Always answers the same way, whether or not the address exists, so the reset
 * form cannot be used to list registered emails.
 */
export async function startPasswordReset(email: string, ip: string | null) {
  const normalized = email.trim().toLowerCase()
  const row = await queryOne<{ id: string; display_name: string; email: string }>(
    'select id, display_name, email from users where email_normalized = $1 and deleted_at is null',
    [normalized],
  )

  if (row) {
    const token = randomToken(32)
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
    await query(
      `insert into auth_tokens (user_id, purpose, token_hash, requested_ip_hash, expires_at)
       values ($1, 'password_reset', $2, $3, $4)`,
      [row.id, digestToken(token), ip ? digestIp(ip) : null, expiresAt],
    )
    await sendEmail({
      to: row.email,
      ...passwordResetEmail(row.display_name, `${env.clientUrl}/reset-password?token=${token}`),
    }).catch((error) => logger.error('Password reset email could not be sent', { error }))

    await recordSecurityEvent({
      userId: row.id,
      category: 'authentication',
      eventType: 'password_reset_requested',
      severity: 'caution',
      message: 'A password reset link was requested.',
      ipHash: ip ? digestIp(ip) : null,
    })
  }

  return { accepted: true }
}

export async function completePasswordReset(input: { token: string; newPassword: string }) {
  const row = await queryOne<{ id: string; user_id: string; expires_at: Date; consumed_at: Date | null }>(
    `select id, user_id, expires_at, consumed_at from auth_tokens where purpose = 'password_reset' and token_hash = $1`,
    [digestToken(input.token)],
  )
  if (!row || row.consumed_at || row.expires_at.getTime() < Date.now()) {
    throw AppError.badRequest('That reset link is no longer usable. Request another one.')
  }

  const user = await queryOne<UserRow>(SELECT_USER, [row.user_id])
  if (!user) throw AppError.badRequest('That reset link is no longer usable. Request another one.')

  const assessment = assessPassword(input.newPassword, { email: user.email, displayName: user.display_name })
  if (!assessment.acceptable) {
    throw AppError.badRequest('The new password is not strong enough yet.', { missingRules: assessment.missingRules })
  }

  const hash = await hashPassword(input.newPassword)
  await transaction(async (client) => {
    await client.query(
      `update users set password_hash = $2, failed_login_attempts = 0, locked_until = null,
              status = case when status = 'locked' and email_verified_at is not null then 'active' else status end
        where id = $1`,
      [user.id, hash],
    )
    await client.query('update auth_tokens set consumed_at = now() where id = $1', [row.id])
  })

  const revoked = await revokeAllSessions(user.id, 'password_changed')

  await createNotification({
    userId: user.id,
    kind: 'security_alert',
    severity: 'warning',
    title: 'Your password was reset',
    body: 'Every session was signed out. If you did not reset it yourself, contact an administrator now.',
    link: '/settings/security',
    dedupeKey: `password-reset:${Date.now()}`,
  })
  await recordSecurityEvent({
    userId: user.id,
    category: 'authentication',
    eventType: 'password_reset_completed',
    severity: 'warning',
    message: `Password reset completed; ${revoked} session(s) were ended.`,
  })

  return { reset: true, revokedSessions: revoked }
}

export async function logout(userId: string, sessionId: string) {
  const revoked = await revokeSession(userId, sessionId, 'logged_out')
  await recordSecurityEvent({
    userId,
    category: 'session',
    eventType: 'logged_out',
    message: 'Signed out of this device.',
    metadata: { sessionId, existed: revoked },
  })
  return { loggedOut: true }
}

export async function loadUserForAuth(userId: string): Promise<PublicUser | null> {
  const row = await queryOne<UserRow>(SELECT_USER, [userId])
  if (!row) return null
  if (row.status === 'suspended') throw AppError.forbidden('This account is suspended. Contact an administrator.')
  return toPublic(row)
}

export { toPublic as mapUserRow }
