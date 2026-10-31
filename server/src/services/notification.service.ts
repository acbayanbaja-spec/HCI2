import { query, queryOne } from '../db/pool'

export type NotificationKind = 'security_alert' | 'recommendation' | 'report_update' | 'learning' | 'emergency' | 'system'
export type NotificationSeverity = 'info' | 'caution' | 'warning' | 'critical'

export type NotificationInput = {
  userId: string
  kind: NotificationKind
  severity?: NotificationSeverity
  title: string
  body: string
  link?: string | null
  dedupeKey?: string | null
}

/**
 * A settings toggle must actually silence something, so these kinds honour the
 * user's preference. Security alerts are deliberately absent: an account
 * takeover warning is not optional.
 */
const MUTABLE_PREF_KEY: Partial<Record<NotificationKind, string>> = {
  report_update: 'reportUpdates',
  recommendation: 'recommendationDigests',
  learning: 'learningNudges',
  emergency: 'emergencyReminders',
}

async function isMuted(userId: string, kind: NotificationKind): Promise<boolean> {
  const prefKey = MUTABLE_PREF_KEY[kind]
  if (!prefKey) return false
  const row = await queryOne<{ value: string | null }>(
    `select notifications ->> $2 as value from user_preferences where user_id = $1`,
    [userId, prefKey],
  )
  return row?.value === 'false'
}

/**
 * Creating a notification twice for the same reason would bury the user, so a
 * dedupe key refreshes the existing row instead of adding another one.
 */
export async function createNotification(input: NotificationInput) {
  if (await isMuted(input.userId, input.kind)) return null

  if (input.dedupeKey) {
    const upserted = await queryOne<{ id: string }>(
      `insert into notifications (user_id, kind, severity, title, body, link, dedupe_key)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (user_id, dedupe_key) do update
         set title = excluded.title,
             body = excluded.body,
             link = excluded.link,
             severity = excluded.severity,
             -- A recurring alert must surface again even if it was dismissed.
             read_at = null,
             archived_at = null,
             created_at = now()
       returning id`,
      [
        input.userId,
        input.kind,
        input.severity ?? 'info',
        input.title.slice(0, 140),
        input.body.slice(0, 800),
        input.link ?? null,
        input.dedupeKey,
      ],
    )
    return upserted?.id ?? null
  }

  const created = await queryOne<{ id: string }>(
    `insert into notifications (user_id, kind, severity, title, body, link)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [input.userId, input.kind, input.severity ?? 'info', input.title.slice(0, 140), input.body.slice(0, 800), input.link ?? null],
  )
  return created?.id ?? null
}

export async function listNotifications(options: {
  userId: string
  filter?: 'all' | 'unread' | 'read' | 'archived'
  kind?: NotificationKind
  limit?: number
  before?: Date
}) {
  const conditions: string[] = ['user_id = $1']
  const params: unknown[] = [options.userId]

  switch (options.filter ?? 'all') {
    case 'unread':
      conditions.push('read_at is null')
      conditions.push('archived_at is null')
      break
    case 'read':
      conditions.push('read_at is not null')
      conditions.push('archived_at is null')
      break
    case 'archived':
      conditions.push('archived_at is not null')
      break
  }

  if (options.kind) {
    params.push(options.kind)
    conditions.push(`kind = $${params.length}`)
  }
  if (options.before) {
    params.push(options.before)
    conditions.push(`created_at < $${params.length}`)
  }

  params.push(Math.min(Math.max(options.limit ?? 40, 1), 100))
  const rows = await query(
    `select id, kind, severity, title, body, link,
            (read_at is not null) as read,
            (archived_at is not null) as archived,
            created_at as "createdAt"
       from notifications
      where ${conditions.join(' and ')}
      order by created_at desc
      limit $${params.length}`,
    params,
  )
  return rows.rows
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    'select count(*)::text as count from notifications where user_id = $1 and read_at is null and archived_at is null',
    [userId],
  )
  return Number(row?.count ?? 0)
}

export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  const result = await query(
    'update notifications set read_at = now() where user_id = $1 and id = $2 and read_at is null',
    [userId, id],
  )
  return (result.rowCount ?? 0) > 0
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await query(
    'update notifications set read_at = now() where user_id = $1 and read_at is null and archived_at is null',
    [userId],
  )
  return result.rowCount ?? 0
}

export async function archiveNotification(userId: string, id: string): Promise<boolean> {
  const result = await query(
    'update notifications set archived_at = now() where user_id = $1 and id = $2 and archived_at is null',
    [userId, id],
  )
  return (result.rowCount ?? 0) > 0
}
