import { Router } from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { AppError } from '../../lib/errors'
import { clientIp, describeUserAgent, readCookie, userAgentHeader } from '../../lib/http'
import { env } from '../../config/env'
import { REFRESH_COOKIE, signAccessToken } from '../../lib/tokens'
import { randomToken } from '../../lib/crypto'
import { PASSWORD_MIN_LENGTH } from '../../lib/password-policy'
import { validateBody } from '../../middleware/validate'
import { authLimiter } from '../../middleware/rate-limit'
import { requireAuth } from '../../middleware/auth'
import { principalOf } from '../types'
import { clearSessionCookies, writeSessionCookies } from '../cookies'
import {
  completeMfaLogin,
  completePasswordReset,
  loadUserForAuth,
  loginUser,
  logout,
  registerUser,
  requestNewVerificationEmail,
  startPasswordReset,
  verifyEmailToken,
  type LoginOutcome,
} from '../../services/auth.service'
import { consumeRefreshToken } from '../../services/session.service'

const emailField = z.string().trim().toLowerCase().email('Enter an email address that looks real.').max(254)
const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(200, 'That password is too long to be typed.')
const verificationCode = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s/g, ''))
  .refine(
    (value) => /^\d{6}$/.test(value) || /^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(value),
    'Enter the six digits from your app, or a recovery code like XXXXX-XXXXX.',
  )
const sessionIdField = z.string().uuid('That sign-in request is not valid.')

const router = Router()

function loginContext(req: Request) {
  return {
    device: describeUserAgent(req.headers['user-agent']),
    userAgent: userAgentHeader(req),
    ip: clientIp(req),
  } as const
}

/**
 * One place turns a service outcome into an HTTP answer, so the lockout, MFA
 * and failure branches cannot drift between the two ways to finish a sign-in.
 */
function respondToLogin(res: Response, outcome: LoginOutcome) {
  if (outcome.kind === 'success') {
    const csrfToken = writeSessionCookies(res, {
      accessToken: outcome.accessToken,
      refreshToken: outcome.refreshToken,
      csrfToken: randomToken(24),
    })
    res.json({ authenticated: true, mfaRequired: false, user: outcome.user, sessionId: outcome.sessionId, csrfToken })
    return
  }

  if (outcome.kind === 'mfa_required') {
    res.status(202).json({
      authenticated: false,
      mfaRequired: true,
      sessionId: outcome.sessionId,
      displayName: outcome.displayName,
      message: 'Enter the six-digit code from your authenticator app to finish signing in.',
    })
    return
  }

  if (outcome.kind === 'locked') {
    throw new AppError(429, 'account_locked', 'Too many failed attempts. Sign-in is paused for a little while.', {
      lockedUntil: outcome.lockedUntil.toISOString(),
      retryAfterSeconds: outcome.retryAfterSeconds,
    })
  }

  // Deliberately vague: the answer must not reveal whether the address exists.
  throw AppError.unauthorized('That email and password combination is not recognised.')
}

router.post(
  '/register',
  authLimiter,
  validateBody(z.object({ email: emailField, password: passwordField, displayName: z.string().trim().min(2, 'Tell us what to call you.').max(80) })),
  async (req, res) => {
    const { email, password, displayName } = req.body as { email: string; password: string; displayName: string }
    const result = await registerUser({ email, password, displayName, context: loginContext(req) })
    res.status(201).json({
      ...result,
      message: result.verificationRequired
        ? 'Account created. Check your email to confirm the address, then sign in.'
        : 'Account created. You can sign in now.',
    })
  },
)

router.post('/login', authLimiter, validateBody(z.object({ email: emailField, password: passwordField })), async (req, res) => {
  const { email, password } = req.body as { email: string; password: string }
  respondToLogin(res, await loginUser({ email, password, context: loginContext(req) }))
})

/** Second factor, and the recovery-code path, share one endpoint and one budget. */
router.post(
  '/login/mfa',
  authLimiter,
  validateBody(z.object({ sessionId: sessionIdField, code: verificationCode })),
  async (req, res) => {
    const { sessionId, code } = req.body as { sessionId: string; code: string }
    respondToLogin(res, await completeMfaLogin({ sessionId, code, context: loginContext(req) }))
  },
)

/**
 * Exchange the httpOnly refresh cookie for a fresh pair. A token that was
 * already rotated revokes its whole family instead of minting another pair.
 */
router.post('/refresh', authLimiter, async (req, res) => {
  const presented = readCookie(req, REFRESH_COOKIE)
  if (!presented) throw AppError.unauthorized('Please sign in again.')

  const rotated = await consumeRefreshToken(presented)
  if (!rotated.ok) {
    clearSessionCookies(res)
    throw AppError.unauthorized(
      rotated.reason === 'reuse_detected'
        ? 'This session was ended for your safety after a sign-in token was seen twice. Please sign in again.'
        : 'That session has expired. Please sign in again.',
    )
  }

  const accessToken = signAccessToken({
    userId: rotated.userId,
    sessionId: rotated.sessionId,
    role: rotated.role,
    mfaVerified: rotated.mfaVerified,
  })
  const csrfToken = writeSessionCookies(res, { accessToken, refreshToken: rotated.session.refreshToken, csrfToken: randomToken(24) })
  res.json({ refreshed: true, role: rotated.role, sessionId: rotated.sessionId, csrfToken })
})

router.get('/me', requireAuth, async (req, res) => {
  const user = await loadUserForAuth(principalOf(req).userId)
  if (!user) throw AppError.unauthorized('Please sign in again.')
  res.json({ user, sessionId: req.sessionId, mfaVerified: req.user?.mfaVerified ?? false })
})

router.post('/logout', requireAuth, async (req, res) => {
  const { userId, sessionId } = principalOf(req)
  await logout(userId, sessionId)
  clearSessionCookies(res)
  res.status(204).end()
})

router.post('/verify-email', authLimiter, validateBody(z.object({ token: z.string().min(20).max(128) })), async (req, res) => {
  const result = await verifyEmailToken((req.body as { token: string }).token)
  res.json({ ...result, message: 'Your email address is confirmed. You can sign in now.' })
})

router.post('/resend-verification', requireAuth, authLimiter, async (req, res) => {
  const result = await requestNewVerificationEmail(principalOf(req).userId, clientIp(req))
  res.json({ ...result, message: 'If that address still needs confirming, a new link is on its way.' })
})

router.post('/forgot-password', authLimiter, validateBody(z.object({ email: emailField })), async (req, res) => {
  await startPasswordReset((req.body as { email: string }).email, clientIp(req))
  // The same answer either way, so this endpoint cannot list registered users.
  res.json({ accepted: true, message: 'If that address has an account, a reset link is on its way.' })
})

router.post(
  '/reset-password',
  authLimiter,
  validateBody(z.object({ token: z.string().min(20).max(128), newPassword: passwordField })),
  async (req, res) => {
    const { token, newPassword } = req.body as { token: string; newPassword: string }
    const result = await completePasswordReset({ token, newPassword })
    clearSessionCookies(res)
    res.json({ ...result, message: 'Password changed. Every device has been signed out.' })
  },
)

/** Lets the client show the same lock rules before a form is ever rejected. */
router.get('/policy', (_req, res) => {
  res.json({
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxFailedLogins: env.auth.maxFailedLogins,
    accountLockMinutes: env.auth.accountLockMinutes,
    accessTokenTtlSeconds: env.auth.accessTokenTtlSeconds,
    mailDelivery: env.mail.transportless ? 'outbox' : 'smtp',
  })
})

export default router
