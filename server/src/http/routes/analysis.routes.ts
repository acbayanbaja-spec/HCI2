import { Router } from 'express'
import { z } from 'zod'
import { AppError } from '../../lib/errors'
import { clientIp } from '../../lib/http'
import { validateBody, parseIdParam, parseQuery } from '../../middleware/validate'
import { analyzeLimiter } from '../../middleware/rate-limit'
import { requireAuth } from '../../middleware/auth'
import { principalOf } from '../types'
import {
  getAnalysis,
  getReportForUser,
  listAnalyses,
  listUserReports,
  reportSuspiciousContent,
  runAnalysis,
} from '../../services/analysis.service'

const MAX_INPUT = 8000

const analyzeSchema = z.object({
  kind: z.enum(['url', 'message', 'email']).default('url'),
  input: z
    .string()
    .min(3, 'Paste a link or the message you are unsure about.')
    .max(MAX_INPUT, 'That is too long to check in one go. Paste the part that worries you.'),
})

const reportSchema = z.object({
  analysisId: z.string().uuid().nullish(),
  target: z.string().trim().min(3, 'Say what you are reporting.').max(2000),
  claimedBrand: z.string().trim().max(60).nullish(),
  reason: z.string().trim().max(1000).nullish(),
})

const router = Router()

/**
 * The analyzer answers with reasons, not a verdict on its own authority. The
 * disclaimer is part of the payload so no screen can accidentally hide it.
 */
router.post('/analyze', requireAuth, analyzeLimiter, validateBody(analyzeSchema), async (req, res) => {
  const { kind, input } = req.body as { kind: 'url' | 'message' | 'email'; input: string }
  const result = await runAnalysis({ userId: principalOf(req).userId, kind, input, ip: clientIp(req) })
  res.status(201).json(result)
})

router.get('/analyses', requireAuth, async (req, res) => {
  const query = parseQuery(
    req,
    z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }),
  )
  res.json({ analyses: await listAnalyses(principalOf(req).userId, query.limit) })
})

router.get('/analyses/:id', requireAuth, async (req, res) => {
  res.json(await getAnalysis(principalOf(req).userId, parseIdParam(req)))
})

router.post('/reports', requireAuth, validateBody(reportSchema), async (req, res) => {
  const { userId } = principalOf(req)
  const body = req.body as { analysisId?: string | null; target: string; claimedBrand?: string | null; reason?: string | null }
  if (body.analysisId) {
    // Only a report the user is allowed to see may be attached to an analysis.
    await getAnalysis(userId, body.analysisId)
  }
  const report = await reportSuspiciousContent({ userId, ...body })
  res.status(201).json({ ...report, message: 'Reported. An administrator will review it, and you will see the outcome here.' })
})

router.get('/reports', requireAuth, async (req, res) => {
  res.json({ reports: await listUserReports(principalOf(req).userId) })
})

router.get('/reports/:id', requireAuth, async (req, res) => {
  const report = await getReportForUser(principalOf(req).userId, parseIdParam(req))
  if (!report) throw AppError.notFound('That report is not in your list.')
  res.json({ report })
})

export default router
