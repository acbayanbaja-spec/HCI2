import { Router } from 'express'
import { z } from 'zod'
import { validateBody, parseIdParam, parseQuery } from '../../middleware/validate'
import { requireAuth } from '../../middleware/auth'
import { principalOf } from '../types'
import { getDashboard } from '../../services/dashboard.service'
import { getStoredScore, recalculate, scoreHistory } from '../../services/score.service'
import { listRecommendations, setRecommendationStatus, syncRecommendations } from '../../services/recommendation.service'

const router = Router()

router.get('/dashboard', requireAuth, async (req, res) => {
  res.json(await getDashboard(principalOf(req).userId, req.sessionId ?? null))
})

/**
 * The score is never a surprise: the same response carries the weighted factors
 * and the plain-language reason behind each one.
 */
router.get('/score', requireAuth, async (req, res) => {
  const { userId } = principalOf(req)
  const score = (await getStoredScore(userId)) ?? (await recalculate(userId, 'manual'))
  res.json({ ...score, howItWorks: HOW_IT_WORKS })
})

router.get('/score/history', requireAuth, async (req, res) => {
  const query = parseQuery(req, z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }))
  res.json({ history: await scoreHistory(principalOf(req).userId, query.limit) })
})

/** Re-run the model against live data, for after a user says "I did it". */
router.post('/score/recalculate', requireAuth, async (req, res) => {
  const { userId } = principalOf(req)
  const score = await recalculate(userId, 'manual')
  await syncRecommendations(userId)
  res.json({ ...score, howItWorks: HOW_IT_WORKS })
})

router.get('/recommendations', requireAuth, async (req, res) => {
  const { userId } = principalOf(req)
  const query = parseQuery(
    req,
    z.object({
      status: z.enum(['open', 'completed', 'dismissed']).optional(),
      priority: z.enum(['high', 'medium', 'low']).optional(),
      category: z.string().trim().max(40).optional(),
    }),
  )
  await syncRecommendations(userId)
  res.json({ recommendations: await listRecommendations(userId, query) })
})

router.patch(
  '/recommendations/:id',
  requireAuth,
  validateBody(z.object({ status: z.enum(['open', 'completed', 'dismissed']) })),
  async (req, res) => {
    const { userId } = principalOf(req)
    const recommendation = await setRecommendationStatus(userId, parseIdParam(req), req.body.status)
    res.json({ recommendation, message: statusMessage(req.body.status) })
  },
)

const HOW_IT_WORKS = [
  'Each part of your digital life carries a weight that adds up to 100.',
  'You earn credit for the protections you actually have, in full or in part.',
  'Anything that does not apply to you is left out instead of marking you down.',
  'Nothing is invented: change something on this platform and the number moves.',
]

function statusMessage(status: string): string {
  if (status === 'completed') return 'Marked as done. Your score and advice were recalculated.'
  if (status === 'dismissed') return 'Put away. It comes back if the reason becomes true again.'
  return 'Reopened.'
}

export default router
