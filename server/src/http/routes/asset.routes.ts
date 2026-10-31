import { Router } from 'express'
import { z } from 'zod'
import { validateBody, parseIdParam } from '../../middleware/validate'
import { requireAuth } from '../../middleware/auth'
import { principalOf } from '../types'
import {
  ACCOUNT_CATEGORIES,
  MFA_METHODS,
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  logReview,
  updateAccount,
} from '../../services/digital-account.service'

const category = z.enum(ACCOUNT_CATEGORIES as unknown as [string, ...string[]])
const mfaMethod = z.enum(MFA_METHODS as unknown as [string, ...string[]])

/**
 * Note what is missing: there is no password field anywhere in this schema,
 * because the platform never accepts one.
 */
const accountSchema = z.object({
  providerName: z.string().trim().min(1, 'Name the account, for example "Gmail".').max(60),
  category: category.default('other'),
  usernameHint: z.string().trim().max(120).nullish(),
  signInUrl: z
    .string()
    .trim()
    .url('That does not look like a web address.')
    .max(300)
    .nullish(),
  mfaEnabled: z.boolean().default(false),
  mfaMethod: mfaMethod.default('none'),
  storedInPasswordManager: z.boolean().default(false),
  uniquePasswordClaimed: z.boolean().default(false),
  recoveryConfigured: z.boolean().default(false),
  reportedBreached: z.boolean().default(false),
  reviewIntervalDays: z.coerce.number().int().min(7).max(365).default(90),
  notes: z.string().trim().max(400, 'Keep the note short.').nullish(),
})

const listSchema = z.object({ category: category.optional() })

const router = Router()

router.get('/', requireAuth, async (req, res) => {
  const query = req.query as { category?: string }
  const accounts = await listAccounts(principalOf(req).userId, typeof query.category === 'string' ? query.category : undefined)
  res.json({ accounts })
})

router.get('/:id', requireAuth, async (req, res) => {
  res.json({ account: await getAccount(principalOf(req).userId, parseIdParam(req)) })
})

router.post('/', requireAuth, validateBody(accountSchema), async (req, res) => {
  const account = await createAccount(principalOf(req).userId, req.body)
  res.status(201).json({ account, message: `${account.providerName} is now part of your safety score.` })
})

router.put('/:id', requireAuth, validateBody(accountSchema), async (req, res) => {
  const account = await updateAccount(principalOf(req).userId, parseIdParam(req), req.body)
  res.json({ account, message: 'Saved.' })
})

router.post('/:id/review', requireAuth, async (req, res) => {
  const account = await logReview(principalOf(req).userId, parseIdParam(req))
  res.json({ account, message: `Review logged for ${account.providerName}. Its next check is due in ${account.reviewIntervalDays} days.` })
})

router.delete('/:id', requireAuth, async (req, res) => {
  await deleteAccount(principalOf(req).userId, parseIdParam(req))
  res.json({ deleted: true, message: 'Removed from your list. Your safety score has been recalculated.' })
})

router.get('/meta/options', (_req, res) => {
  res.json({ categories: ACCOUNT_CATEGORIES, mfaMethods: MFA_METHODS })
})

export default router
