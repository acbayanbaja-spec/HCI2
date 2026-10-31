import { query } from '../db/pool'
import { logger } from '../lib/logger'

export type SecurityEventInput = {
  userId?: string | null
  actorType?: 'user' | 'admin' | 'system' | 'anonymous'
  actorId?: string | null
  category:
    | 'authentication'
    | 'session'
    | 'profile'
    | 'mfa'
    | 'account_asset'
    | 'assessment'
    | 'recommendation'
    | 'analysis'
    | 'report'
    | 'incident'
    | 'emergency'
    | 'learning'
    | 'privacy'
    | 'notification'
    | 'administration'
    | 'system'
  eventType: string
  message: string
  severity?: 'info' | 'caution' | 'warning' | 'critical'
  ipHash?: string | null
  metadata?: Record<string, unknown>
}

/**
 * The integrity half of Information Assurance: everything security-relevant is
 * written to an append-only history. A failed audit write is logged loudly but
 * does not break the user's flow - availability wins over completeness here, and
 * the gap itself stays observable.
 */
export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    await query(
      `insert into security_events
         (user_id, actor_type, actor_id, category, event_type, message, severity, ip_hash, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        input.userId ?? null,
        input.actorType ?? 'system',
        input.actorId ?? input.userId ?? null,
        input.category,
        input.eventType,
        input.message.slice(0, 500),
        input.severity ?? 'info',
        input.ipHash ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    )
  } catch (error) {
    logger.error('Failed to write a security event', { error, eventType: input.eventType })
  }
}

export async function listSecurityEvents(options: {
  userId: string
  search?: string
  category?: string
  severity?: string
  from?: Date
  to?: Date
  limit?: number
}) {
  const conditions: string[] = ['user_id = $1']
  const params: unknown[] = [options.userId]

  if (options.category) {
    params.push(options.category)
    conditions.push(`category = $${params.length}`)
  }
  if (options.severity) {
    params.push(options.severity)
    conditions.push(`severity = $${params.length}`)
  }
  if (options.from) {
    params.push(options.from)
    conditions.push(`created_at >= $${params.length}`)
  }
  if (options.to) {
    params.push(options.to)
    conditions.push(`created_at <= $${params.length}`)
  }
  if (options.search) {
    // Escaped as a literal pattern; never concatenated into the statement.
    params.push(`%${options.search.replace(/[%_\\]/g, '\\$&')}%`)
    conditions.push(`(message ilike $${params.length} escape '\\' or event_type ilike $${params.length} escape '\\')`)
  }

  params.push(Math.min(Math.max(options.limit ?? 50, 1), 200))
  const result = await query(
    `select id, category, event_type as "eventType", message, severity, created_at as "createdAt", metadata
       from security_events
      where ${conditions.join(' and ')}
      order by created_at desc
      limit $${params.length}`,
    params,
  )
  return result.rows
}
