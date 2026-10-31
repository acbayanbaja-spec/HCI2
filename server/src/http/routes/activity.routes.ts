import { Router } from 'express'
import { z } from 'zod'
import { AppError } from '../../lib/errors'
import { parseIdParam, parseQuery, validateBody } from '../../middleware/validate'
import { requireAuth } from '../../middleware/auth'
import { principalOf } from '../types'
import {
  archiveNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from '../../services/notification.service'
import { listSecurityEvents } from '../../services/audit.service'
import { refreshAssessment } from '../../services/recommendation.service'

const router = Router()

const filterSchema = z.object({
  filter: z.enum(['all', 'unread', 'read', 'archived']).default('all'),
  kind: z.enum(['security_alert', 'recommendation', 'report_update', 'learning', 'emergency', 'system']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
})

router.get('/notifications', requireAuth, async (req, res) => {
  const query = parseQuery(req, filterSchema)
  res.json({
    notifications: await listNotifications({
      userId: principalOf(req).userId,
      filter: query.filter,
      kind: query.kind,
      limit: query.limit,
    }),
    unread: await unreadNotificationCount(principalOf(req).userId),
  })
})

/** Cheap enough for the header badge to poll after a mutation. */
router.get('/notifications/unread-count', requireAuth, async (req, res) => {
  res.json({ unread: await unreadNotificationCount(principalOf(req).userId) })
})

/* --- Alerts ---------------------------------------------------------------- */

/**
 * Alert hygiene is a scored factor, so acting on an alert has to move the number
 * on the spot. A score that ignores what the user just did is not explainable.
 */
router.post('/notifications/:id/read', requireAuth, async (req, res) => {
  const { userId } = principalOf(req)
  const updated = await markNotificationRead(userId, parseIdParam(req))
  if (!updated) throw AppError.notFound('That alert is not here any more.')
  const { score } = await refreshAssessment(userId, 'alerts_reviewed')
  res.json({ read: true, score })
})

router.post('/notifications/read-all', requireAuth, async (req, res) => {
  const { userId } = principalOf(req)
  const count = await markAllNotificationsRead(userId)
  const { score } = await refreshAssessment(userId, 'alerts_reviewed')
  res.json({ marked: count, score })
})

router.post('/notifications/:id/archive', requireAuth, async (req, res) => {
  const { userId } = principalOf(req)
  const archived = await archiveNotification(userId, parseIdParam(req))
  if (!archived) throw AppError.notFound('That alert is not here any more.')
  const { score } = await refreshAssessment(userId, 'alerts_reviewed')
  res.json({ archived: true, score })
})

/* --- Security activity history ------------------------------------------- */

const eventSchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(40).optional(),
  severity: z.enum(['info', 'caution', 'warning', 'critical']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

router.get('/events', requireAuth, async (req, res) => {
  const query = parseQuery(req, eventSchema)
  res.json({
    events: await listSecurityEvents({ userId: principalOf(req).userId, ...query }),
    note: 'These are the security actions Digital Guardian recorded for your account. Logs cannot be edited or deleted by design.',
  })
})

export default router
