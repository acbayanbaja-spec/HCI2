import type { Response } from 'express'
import { randomToken } from '../lib/crypto'
import { env } from '../config/env'
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  cookieOptions,
} from '../lib/tokens'

export type SessionCookies = {
  accessToken: string
  refreshToken: string
  csrfToken?: string
}

/**
 * The access token lives in an httpOnly cookie so XSS cannot read it, and a
 * second httpOnly cookie carries the refresh token. The CSRF cookie is
 * deliberately readable by scripts: the browser only proves itself by copying
 * that value into a header, which a cross-site page cannot do.
 */
export function writeSessionCookies(res: Response, session: SessionCookies): string {
  const csrf = session.csrfToken ?? randomToken(24)

  res.cookie(ACCESS_COOKIE, session.accessToken, cookieOptions(env.auth.accessTokenTtlSeconds))
  res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(env.auth.refreshTokenTtlDays * 24 * 60 * 60))
  res.cookie(CSRF_COOKIE, csrf, {
    ...cookieOptions(env.auth.refreshTokenTtlDays * 24 * 60 * 60),
    httpOnly: false,
  })

  return csrf
}

export function clearSessionCookies(res: Response): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]) {
    res.clearCookie(name, { ...cookieOptions(0), maxAge: undefined })
  }
}
