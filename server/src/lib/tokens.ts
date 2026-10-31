import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { AppError } from './errors'

export const ACCESS_COOKIE = 'dg_access'
export const REFRESH_COOKIE = 'dg_refresh'
export const CSRF_COOKIE = 'dg_csrf'
export const CSRF_HEADER = 'x-csrf-token'

const ISSUER = 'digital-guardian'
const AUDIENCE = 'digital-guardian-web'

export type AccessTokenClaims = {
  sub: string
  sid: string
  role: string
  mfa: boolean
  typ: 'access'
}

export function signAccessToken(input: { userId: string; sessionId: string; role: string; mfaVerified: boolean }): string {
  const payload: Omit<AccessTokenClaims, 'typ'> & { typ?: string } = {
    sub: input.userId,
    sid: input.sessionId,
    role: input.role,
    mfa: input.mfaVerified,
  }
  return jwt.sign({ ...payload, typ: 'access' }, env.auth.accessTokenSecret, {
    algorithm: 'HS256',
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.auth.accessTokenTtlSeconds,
  })
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, env.auth.accessTokenSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
      clockTolerance: 5,
    })
    if (typeof decoded === 'string' || decoded.typ !== 'access' || typeof decoded.sub !== 'string') {
      throw AppError.unauthorized('This session is no longer valid. Please sign in again.')
    }
    return {
      sub: decoded.sub,
      sid: String(decoded.sid ?? ''),
      role: String(decoded.role ?? 'user'),
      mfa: Boolean(decoded.mfa),
      typ: 'access',
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'token_expired', 'Your session expired. Refreshing it now.')
    }
    throw AppError.unauthorized('This session is no longer valid. Please sign in again.')
  }
}

/** Refresh tokens are opaque random strings; only their digest is stored. */
export function decodeBearer(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  return token.length > 0 ? token : null
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.cookies.secure,
    sameSite: env.cookies.sameSite as 'lax' | 'none' | 'strict',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
    ...(env.cookies.domain ? { domain: env.cookies.domain } : {}),
  }
}
