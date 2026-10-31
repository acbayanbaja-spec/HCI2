import crypto from 'node:crypto'
import { query, queryOne } from '../db/pool'

/**
 * One read model for both the Digital Safety Score and the recommendation
 * engine. Sharing it means a score and the advice next to it can never disagree.
 */

export const CATEGORY_CRITICALITY: Record<string, number> = {
  finance: 5,
  email: 5,
  government: 4,
  work: 4,
  school: 4,
  health: 4,
  developer: 3,
  social: 2,
  shopping: 2,
  entertainment: 1,
  other: 2,
}

export type AccountSignal = {
  id: string
  providerName: string
  category: string
  mfaEnabled: boolean
  mfaMethod: string
  storedInPasswordManager: boolean
  recoveryConfigured: boolean
  reportedBreached: boolean
  lastReviewedAt: Date | null
  reviewIntervalDays: number
}

export type SecuritySignals = {
  userId: string
  mfaEnabled: boolean
  emailVerified: boolean
  recoveryEmail: string | null
  accountCount: number
  accounts: AccountSignal[]
  unreviewedAccounts: number
  staleReviewedAccounts: number
  checklistTotal: number
  checklistDone: number
  lessonsTotal: number
  lessonsCompleted: number
  unreadCriticalAlerts: number
  unreadWarningAlerts: number
  openIncidents: number
  openHighSeverityIncidents: number
  suspiciousAnalysesLast30Days: number
  failedLoginsLast24h: number
  activeSessions: number
}

function toSignals(rows: Record<string, unknown>[]): AccountSignal[] {
  return rows.map((row) => ({
    id: String(row.id),
    providerName: String(row.provider_name),
    category: String(row.category),
    mfaEnabled: Boolean(row.mfa_enabled),
    mfaMethod: String(row.mfa_method),
    storedInPasswordManager: Boolean(row.stored_in_password_manager),
    recoveryConfigured: Boolean(row.recovery_configured),
    reportedBreached: Boolean(row.reported_breached),
    lastReviewedAt: row.last_reviewed_at ? new Date(String(row.last_reviewed_at)) : null,
    reviewIntervalDays: Number(row.review_interval_days),
  }))
}

export async function collectSignals(userId: string): Promise<SecuritySignals> {
  const [identity, accounts, checklist, learning, alerts, incidents, exposure, logins, sessions] = await Promise.all([
    queryOne<{ mfa_enabled: boolean; email_verified_at: Date | null; recovery_email: string | null }>(
      `select u.mfa_enabled, u.email_verified_at, p.recovery_email
         from users u
         left join user_profiles p on p.user_id = u.id
        where u.id = $1`,
      [userId],
    ),

    query<Record<string, unknown>>(
      `select id, provider_name, category, mfa_enabled, mfa_method, stored_in_password_manager,
              recovery_configured, reported_breached, last_reviewed_at, review_interval_days
         from digital_accounts
        where user_id = $1
        order by created_at`,
      [userId],
    ),

    queryOne<{ total: string; done: string }>(
      `select count(i.key)::text as total,
              coalesce(nullif(count(s.id) filter (where s.done = true), 0), 0)::text as done
         from privacy_items i
         left join privacy_checklist_states s on s.item_key = i.key and s.user_id = $1
        where i.published = true`,
      [userId],
    ),

    queryOne<{ total: string; completed: string }>(
      `select count(l.id)::text as total,
              coalesce(count(p.lesson_id) filter (where p.status = 'completed'), 0)::text as completed
         from learning_lessons l
         join learning_modules m on m.id = l.module_id
         left join lesson_progress p on p.lesson_id = l.id and p.user_id = $1
        where l.published = true and m.published = true`,
      [userId],
    ),

    queryOne<{ critical: string; warning: string }>(
      `select count(*) filter (where severity = 'critical')::text as critical,
              count(*) filter (where severity = 'warning')::text as warning
         from notifications
        where user_id = $1 and read_at is null and archived_at is null and kind = 'security_alert'`,
      [userId],
    ),

    queryOne<{ open: string; high: string }>(
      `select count(*)::text as open,
              count(*) filter (where severity in ('high', 'critical'))::text as high
         from incidents
        where user_id = $1 and status in ('open', 'investigating', 'contained')`,
      [userId],
    ),

    queryOne<{ count: string }>(
      `select count(*)::text as count
         from content_analyses
        where user_id = $1 and verdict in ('suspicious', 'high') and created_at > now() - interval '30 days'`,
      [userId],
    ),

    queryOne<{ count: string }>(
      `select count(*)::text as count
         from login_attempts
        where user_id = $1
          and outcome in ('invalid_credentials', 'mfa_failed', 'locked')
          and created_at > now() - interval '24 hours'`,
      [userId],
    ),

    queryOne<{ count: string }>(
      `select count(*)::text as count
         from auth_sessions
        where user_id = $1 and revoked_at is null and expires_at > now()`,
      [userId],
    ),
  ])

  const accountList = toSignals(accounts.rows)
  const now = Date.now()
  const stale = accountList.filter(
    (account) =>
      !account.lastReviewedAt ||
      now - account.lastReviewedAt.getTime() > account.reviewIntervalDays * 24 * 60 * 60 * 1000,
  )

  return {
    userId,
    mfaEnabled: Boolean(identity?.mfa_enabled),
    emailVerified: Boolean(identity?.email_verified_at),
    recoveryEmail: identity?.recovery_email ?? null,
    accountCount: accountList.length,
    accounts: accountList,
    unreviewedAccounts: accountList.filter((account) => !account.lastReviewedAt).length,
    staleReviewedAccounts: stale.length,
    checklistTotal: Number(checklist?.total ?? 0),
    checklistDone: Number(checklist?.done ?? 0),
    lessonsTotal: Number(learning?.total ?? 0),
    lessonsCompleted: Number(learning?.completed ?? 0),
    unreadCriticalAlerts: Number(alerts?.critical ?? 0),
    unreadWarningAlerts: Number(alerts?.warning ?? 0),
    openIncidents: Number(incidents?.open ?? 0),
    openHighSeverityIncidents: Number(incidents?.high ?? 0),
    suspiciousAnalysesLast30Days: Number(exposure?.count ?? 0),
    failedLoginsLast24h: Number(logins?.count ?? 0),
    activeSessions: Number(sessions?.count ?? 0),
  }
}

/** Stable digest of the inputs, so "same facts, same score" is provable. */
export function fingerprintSignals(signals: SecuritySignals): string {
  const canonical = JSON.stringify(
    {
      mfa: signals.mfaEnabled,
      verified: signals.emailVerified,
      recovery: Boolean(signals.recoveryEmail),
      accounts: signals.accounts
        .map((account) => [account.category, account.mfaEnabled, account.recoveryConfigured, account.storedInPasswordManager, account.lastReviewedAt?.toISOString() ?? null])
        .sort(),
      checklist: [signals.checklistDone, signals.checklistTotal],
      learning: [signals.lessonsCompleted, signals.lessonsTotal],
      alerts: [signals.unreadCriticalAlerts, signals.unreadWarningAlerts],
      incidents: [signals.openIncidents, signals.openHighSeverityIncidents],
      exposure: signals.suspiciousAnalysesLast30Days,
      failedLogins: signals.failedLoginsLast24h,
    },
  )
  return crypto.createHash('sha256').update(canonical).digest('hex')
}
