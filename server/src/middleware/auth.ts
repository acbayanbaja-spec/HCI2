import type { RequestHandler } from 'express'
import { AppError } from '../lib/errors'
import { constantTimeEqual, digestIp } from '../lib/crypto'
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER, decodeBearer, verifyAccessToken } from '../lib/tokens'
import { clientIp, readCookie } from '../lib/http'
import { loadPrincipal, touchSession } from '../services/session.service'

/**
 * Authentication is proven twice: the signed token says who claims to be here,
 * and the database says whether that session is still live. Revoking a session
 * therefore takes effect on the very next request, not when the token expires.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const bearer = decodeBearer(req)
    const token = bearer ?? readCookie(req, ACCESS_COOKIE)
    if (!token) throw AppError.unauthorized()

    const claims = verifyAccessToken(token)
    const principal = await loadPrincipal(claims.sid)
    if (!principal) throw AppError.unauthorized('This session has ended. Please sign in again.')
    if (principal.userStatus === 'suspended') throw AppError.forbidden('This account is suspended. Contact an administrator.')

    req.user = { id: principal.userId, role: principal.role, mfaVerified: principal.mfaVerified }
    req.sessionId = principal.sessionId

    await touchSession(principal.sessionId, digestIp(clientIp(req)))
    next()
  } catch (error) {
    next(error)
  }
}

/**
 * Authorisation is enforced here, on the server. Hiding an admin screen in the
 * client is a courtesy; it is never what stops a request.
 */
export function requireRole(...roles: Array<'user' | 'admin'>): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(AppError.unauthorized())
      return
    }
    if (!roles.includes(req.user.role)) {
      next(AppError.forbidden('Your account is not allowed to do that.'))
      return
    }
    next()
  }
}

export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Double-submit CSRF check, decided from the request itself so it can run
 * before the session lookup. A bearer-token caller is exempt because a
 * cross-site page cannot attach an Authorization header on its own.
 */
export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next()
    return
  }

  const usesCookieAuth = !decodeBearer(req) && Boolean(readCookie(req, ACCESS_COOKIE))
  if (!usesCookieAuth) {
    next()
    return
  }

  const cookie = readCookie(req, CSRF_COOKIE)
  const header = req.headers[CSRF_HEADER]
  if (!cookie || typeof header !== 'string' || !constantTimeEqual(cookie, header)) {
    next(new AppError(403, 'forbidden', 'This request could not be confirmed as coming from your own browser. Reload the page and try again.'))
    return
  }
  next()
}
