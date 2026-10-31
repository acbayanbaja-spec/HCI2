import { Router } from 'express'
import { z } from 'zod'
import { AppError } from '../../lib/errors'
import { PASSWORD_MIN_LENGTH } from '../../lib/password-policy'
import { parseIdParam, validateBody } from '../../middleware/validate'
import { requireAuth } from '../../middleware/auth'
import { principalOf } from '../types'
import {
  beginMfaSetup,
  changePassword,
  confirmMfaSetup,
  disableMfa,
  regenerateRecoveryCodes,
} from '../../services/auth.service'
import { getProfile, updatePreferences, updateProfile } from '../../services/profile.service'
import { listSessions, revokeAllSessions, revokeSession } from '../../services/session.service'
import { recordSecurityEvent } from '../../services/audit.service'
import { refreshAssessment } from '../../services/recommendation.service'

const emailField = z.string().trim().toLowerCase().email('Enter an email address that looks real.').max(254)

const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'Tell us what to call you.').max(80),
  fullName: z.string().trim().max(120).nullish(),
  preferredName: z.string().trim().max(60).nullish(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{6,20}$/, 'That phone number does not look usable.')
    .nullish(),
  recoveryEmail: emailField.nullish(),
  timezone: z.string().trim().min(1).max(64).default('Asia/Manila'),
  locale: z.string().trim().min(2).max(16).default('en-PH'),
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(200),
  newPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(200),
})

const router = Router()

/* --- Profile and preferences --------------------------------------------- */

router.get('/profile', requireAuth, async (req, res) => {
  res.json(await getProfile(principalOf(req).userId))
})

router.put('/profile', requireAuth, validateBody(profileSchema), async (req, res) => {
  const { userId } = principalOf(req)
  const profile = await updateProfile(userId, req.body)
  // A recovery address is a scored input, so changing it moves the number.
  const { score } = await refreshAssessment(userId, 'account_updated')
  res.json({ profile, score })
})

router.put(
  '/preferences',
  requireAuth,
  validateBody(
    z.object({
      theme: z.enum(['system', 'light', 'dark']).optional(),
      notifications: z
        .object({
          recommendationDigests: z.boolean().optional(),
          reportUpdates: z.boolean().optional(),
          learningNudges: z.boolean().optional(),
          emergencyReminders: z.boolean().optional(),
        })
        .optional(),
    }),
  ),
  async (req, res) => {
    res.json(await updatePreferences(principalOf(req).userId, req.body))
  },
)

/* --- Password and two-step verification ---------------------------------- */

router.put('/password', requireAuth, validateBody(passwordSchema), async (req, res) => {
  const { userId, sessionId } = principalOf(req)
  const result = await changePassword({ userId, currentPassword: req.body.currentPassword, newPassword: req.body.newPassword, sessionId })
  res.json({ ...result, message: result.revokedSessions > 0 ? `Password changed. ${result.revokedSessions} other session(s) were signed out.` : 'Password changed.' })
})

router.post('/mfa/setup', requireAuth, async (req, res) => {
  res.json(await beginMfaSetup(principalOf(req).userId))
})

router.post('/mfa/enable', requireAuth, validateBody(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the six digits shown by your app.') })), async (req, res) => {
  const result = await confirmMfaSetup(principalOf(req).userId, req.body.code)
  res.json({
    ...result,
    message: 'Two-step verification is on. Save these recovery codes now - they are shown once and each works once.',
  })
})

router.post(
  '/mfa/disable',
  requireAuth,
  validateBody(z.object({ password: z.string().min(1, 'Enter your password.').max(200), code: z.string().trim().min(5).max(20) })),
  async (req, res) => {
    const result = await disableMfa(principalOf(req).userId, { password: req.body.password, code: req.body.code })
    res.json({ ...result, message: 'Two-step verification is off and every session was signed out.' })
  },
)

router.post('/mfa/recovery-codes', requireAuth, async (req, res) => {
  const result = await regenerateRecoveryCodes(principalOf(req).userId)
  res.json({ ...result, message: 'A new set of recovery codes was created. The old ones no longer work.' })
})

/* --- Devices and sessions ------------------------------------------------ */

router.get('/sessions', requireAuth, async (req, res) => {
  const { userId, sessionId } = principalOf(req)
  const sessions = await listSessions(userId, sessionId)
  res.json({
    sessions,
    note: 'Digital Guardian records the browser and operating system it was told by your device. It does not track a precise location.',
  })
})

router.delete('/sessions/:id', requireAuth, async (req, res) => {
  const { userId, sessionId } = principalOf(req)
  const target = parseIdParam(req)
  if (target === sessionId) {
    throw AppError.badRequest('To sign this device out, use Sign out.')
  }

  const revoked = await revokeSession(userId, target, 'manual')
  if (!revoked) throw AppError.notFound('That session has already ended.')

  await recordSecurityEvent({
    userId,
    category: 'session',
    eventType: 'session_revoked',
    message: 'A session was signed out from the session list.',
    metadata: { sessionId: target },
  })
  res.json({ revoked: true })
})

/**
 * The emergency answer to "someone else might be in my account": every device
 * except this one is signed out at once, and the user is told the count.
 */
router.post('/sessions/revoke-others', requireAuth, async (req, res) => {
  const { userId, sessionId } = principalOf(req)
  const count = await revokeAllSessions(userId, 'all_other_sessions', sessionId)
  await recordSecurityEvent({
    userId,
    category: 'session',
    eventType: 'all_other_sessions_revoked',
    severity: 'caution',
    message: `Signed out ${count} other session(s) from this account.`,
  })
  res.json({ revokedSessions: count, message: count === 0 ? 'No other sessions were active.' : `${count} other session(s) were signed out.` })
})

/** Session counts feed the "unfamiliar device" factor without a second query. */
router.get('/sessions/summary', requireAuth, async (req, res) => {
  const { userId, sessionId } = principalOf(req)
  const sessions = await listSessions(userId, sessionId)
  res.json({
    total: sessions.length,
    current: sessions.filter((s) => s.isCurrent).length,
    mobile: sessions.filter((s) => s.platform === 'mobile').length,
    signedInWithMfa: sessions.filter((s) => s.signedInWithMfa).length,
  })
})

export default router
