import { AppError } from '../lib/errors'
import { digestToken, randomToken } from '../lib/crypto'
import { env } from '../config/env'
import { query, queryOne, transaction } from '../db/pool'
import type { PoolClient } from 'pg'
import type { DeviceInfo } from '../lib/http'

export type SessionRow = {
  id: string
  user_id: string
  family_id: string
  token_hash: string
  device_label: string | null
  browser: string | null
  os: string | null
  platform: string | null
  user_agent: string | null
  ip_hash: string | null
  auth_method: 'password' | 'password_mfa' | 'recovery_code'
  mfa_verified: boolean
  created_at: Date
  last_seen_at: Date
  expires_at: Date
  revoked_at: Date | null
  revoked_reason: string | null
}

export type IssuedSession = { sessionId: string; refreshToken: string; familyId: string; expiresAt: Date }

export type NewSessionInput = {
  userId: string
  device: DeviceInfo
  userAgent: string
  ipHash: string | null
  authMethod: SessionRow['auth_method']
  mfaVerified: boolean
  familyId?: string
  rotatedFromId?: string | null
  /** Shortens a session that is still waiting for its second factor. */
  ttlMs?: number
  /** Passed during rotation so parent and child commit or roll back together. */
  client?: PoolClient
}

/**
 * Sessions are the single source of truth for "who is signed in where".
 * The plaintext refresh token never reaches the database - only its digest.
 */
export async function createSession(input: NewSessionInput): Promise<IssuedSession> {
  const refreshToken = randomToken(48)
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? env.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000))
  const sql = `insert into auth_sessions
       (user_id, family_id, token_hash, rotated_from_id, device_label, browser, os, platform,
        user_agent, ip_hash, auth_method, mfa_verified, last_seen_at, expires_at)
     values ($1, coalesce($2, gen_random_uuid()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13)
     returning id, family_id`
  const params = [
    input.userId,
    input.familyId ?? null,
    digestToken(refreshToken),
    input.rotatedFromId ?? null,
    input.device.label,
    input.device.browser,
    input.device.os,
    input.device.platform,
    input.userAgent.slice(0, 300),
    input.ipHash,
    input.authMethod,
    input.mfaVerified,
    expiresAt,
  ]

  const runner = input.client ?? null
  const result = runner ? await runner.query<{ id: string; family_id: string }>(sql, params) : await query<{ id: string; family_id: string }>(sql, params)
  const row = result.rows[0]
  if (!row) throw new AppError(500, 'internal_error', 'Could not open a session.')

  return { sessionId: row.id, refreshToken, familyId: row.family_id, expiresAt }
}

export type RotateResult =
  | { ok: true; session: IssuedSession; sessionId: string; userId: string; role: 'user' | 'admin'; mfaVerified: boolean }
  | { ok: false; reason: 'unknown' | 'reuse_detected' | 'expired' }

/**
 * Rotating a refresh token marks the previous one as used. Presenting a token
 * that was already rotated means it leaked, so the whole family is revoked -
 * the standard defence against refresh-token replay.
 */
export async function consumeRefreshToken(presentedToken: string): Promise<RotateResult> {
  const tokenHash = digestToken(presentedToken)

  return transaction(async (client) => {
    const found = await client.query<SessionRow & { user_role: 'user' | 'admin'; user_usable: boolean }>(
      `select s.*, u.role_key as user_role, (u.deleted_at is null and u.status <> 'suspended') as user_usable
         from auth_sessions s
         join users u on u.id = s.user_id
        where s.token_hash = $1
        for update of s`,
      [tokenHash],
    )
    const current = found.rows[0]
    if (!current || !current.user_usable) return { ok: false as const, reason: 'unknown' as const }

    if (current.revoked_at) {
      if (current.revoked_reason === 'reuse_detected' || current.revoked_reason === 'rotated') {
        await client.query(
          `update auth_sessions
             set revoked_at = now(), revoked_reason = 'reuse_detected'
           where family_id = $1 and revoked_at is null`,
          [current.family_id],
        )
      }
      return { ok: false as const, reason: 'reuse_detected' as const }
    }

    if (current.expires_at.getTime() <= Date.now()) {
      await client.query(
        `update auth_sessions set revoked_at = now(), revoked_reason = 'expired' where id = $1`,
        [current.id],
      )
      return { ok: false as const, reason: 'expired' as const }
    }

    await client.query(
      `update auth_sessions set revoked_at = now(), revoked_reason = 'rotated' where id = $1`,
      [current.id],
    )

    const issued = await createSession({
      userId: current.user_id,
      device: {
        browser: current.browser ?? 'Unknown browser',
        os: current.os ?? 'Unknown OS',
        platform: current.platform ?? 'desktop',
        label: current.device_label ?? 'Unknown device',
      },
      userAgent: current.user_agent ?? '',
      ipHash: current.ip_hash,
      authMethod: current.auth_method,
      mfaVerified: current.mfa_verified,
      familyId: current.family_id,
      rotatedFromId: current.id,
      client,
    })

    return {
      ok: true as const,
      session: issued,
      sessionId: issued.sessionId,
      userId: current.user_id,
      role: current.user_role,
      mfaVerified: current.mfa_verified,
    }
  })
}

/**
 * An MFA challenge opens a session before the second factor is proven, so the
 * browser never receives a usable token for an unverified session. Once the
 * code checks out, that provisional row is replaced by a verified child in the
 * same family - the same rotation the refresh endpoint uses.
 */
export async function verifyPendingSession(
  sessionId: string,
  authMethod: SessionRow['auth_method'],
): Promise<IssuedSession & { userId: string }> {
  return transaction(async (client) => {
    const found = await client.query<SessionRow>(
      `select * from auth_sessions where id = $1 for update`,
      [sessionId],
    )
    const pending = found.rows[0]
    if (!pending || pending.revoked_at || pending.expires_at.getTime() <= Date.now()) {
      throw AppError.unauthorized('That sign-in request expired. Start again.')
    }

    const issued = await createSession({
      userId: pending.user_id,
      device: {
        browser: pending.browser ?? 'Unknown browser',
        os: pending.os ?? 'Unknown OS',
        platform: pending.platform ?? 'desktop',
        label: pending.device_label ?? 'Unknown device',
      },
      userAgent: pending.user_agent ?? '',
      ipHash: pending.ip_hash,
      authMethod,
      mfaVerified: true,
      familyId: pending.family_id,
      rotatedFromId: pending.id,
      client,
    })
    await client.query(
      `update auth_sessions set revoked_at = now(), revoked_reason = 'rotated' where id = $1`,
      [pending.id],
    )

    return { ...issued, userId: pending.user_id }
  })
}

export type Principal = {
  sessionId: string
  userId: string
  role: 'user' | 'admin'
  mfaVerified: boolean
  userStatus: string
  emailVerified: boolean
}

/**
 * One join answers every authorisation question the middleware needs: is this
 * session still live, and what may its account do. Sessions are checked
 * against the database on each request so revocation is immediate.
 */
export async function loadPrincipal(sessionId: string): Promise<Principal | undefined> {
  return queryOne<Principal>(
    `select s.id as "sessionId", u.id as "userId", u.role_key as "role", s.mfa_verified as "mfaVerified",
            u.status as "userStatus", (u.email_verified_at is not null) as "emailVerified"
       from auth_sessions s
       join users u on u.id = s.user_id
      where s.id = $1 and s.revoked_at is null and s.expires_at > now() and u.deleted_at is null`,
    [sessionId],
  )
}

export async function findActiveSession(sessionId: string) {
  return queryOne<{ id: string; user_id: string; mfa_verified: boolean; expires_at: Date; revoked_at: Date | null }>(
    `select id, user_id, mfa_verified, expires_at, revoked_at
       from auth_sessions
      where id = $1 and revoked_at is null and expires_at > now()`,
    [sessionId],
  )
}

export async function touchSession(sessionId: string, ipHash: string | null): Promise<void> {
  // Only write once per minute; a busy SPA would otherwise update on every call.
  await query(
    `update auth_sessions
        set last_seen_at = now(), ip_hash = coalesce($2, ip_hash)
      where id = $1
        and (last_seen_at is null or last_seen_at < now() - interval '1 minute')`,
    [sessionId, ipHash],
  )
}

export async function revokeSession(userId: string, sessionId: string, reason: string): Promise<boolean> {
  const result = await query(
    `update auth_sessions
        set revoked_at = now(), revoked_reason = $3
      where id = $1 and user_id = $2 and revoked_at is null`,
    [sessionId, userId, reason],
  )
  return (result.rowCount ?? 0) > 0
}

export async function revokeAllSessions(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
  const result = exceptSessionId
    ? await query(
        `update auth_sessions
            set revoked_at = now(), revoked_reason = $2
          where user_id = $1 and revoked_at is null and id <> $3`,
        [userId, reason, exceptSessionId],
      )
    : await query(
        `update auth_sessions set revoked_at = now(), revoked_reason = $2 where user_id = $1 and revoked_at is null`,
        [userId, reason],
      )
  return result.rowCount ?? 0
}

export type PublicSession = {
  id: string
  deviceLabel: string
  browser: string | null
  os: string | null
  platform: string | null
  isCurrent: boolean
  signedInWithMfa: boolean
  createdAt: Date
  lastSeenAt: Date
  expiresAt: Date
}

export async function listSessions(userId: string, currentSessionId: string | null): Promise<PublicSession[]> {
  const rows = await query<SessionRow>(
    `select * from auth_sessions
      where user_id = $1
        and revoked_at is null
        and expires_at > now()
      order by last_seen_at desc`,
    [userId],
  )

  return rows.rows.map((row) => ({
    id: row.id,
    deviceLabel: row.device_label ?? 'Unknown device',
    browser: row.browser,
    os: row.os,
    platform: row.platform,
    isCurrent: row.id === currentSessionId,
    signedInWithMfa: row.mfa_verified,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  }))
}

export async function revokeFamily(familyId: string): Promise<void> {
  await query(
    `update auth_sessions set revoked_at = now(), revoked_reason = 'reuse_detected'
      where family_id = $1 and revoked_at is null`,
    [familyId],
  )
}

export async function purgeExpiredSessions(): Promise<number> {
  const result = await query('delete from auth_sessions where expires_at < now() - interval \'30 days\'')
  return result.rowCount ?? 0
}
