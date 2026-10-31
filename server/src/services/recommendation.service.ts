import { AppError } from '../lib/errors'
import { query, queryOne, transaction } from '../db/pool'
import { recordSecurityEvent } from './audit.service'
import { recalculate, type AssessmentTrigger } from './score.service'
import { CATEGORY_CRITICALITY, collectSignals, type SecuritySignals } from './signals'

export type RecommendationPriority = 'high' | 'medium' | 'low'
export type RecommendationStatus = 'open' | 'completed' | 'dismissed'

export type GeneratedRecommendation = {
  key: string
  category:
    | 'authentication'
    | 'accounts'
    | 'recovery'
    | 'alerts'
    | 'learning'
    | 'privacy'
    | 'incidents'
    | 'sessions'
  priority: RecommendationPriority
  title: string
  detail: string
  actionLabel: string
  actionHref: string
  learnHref?: string
  weight: number
  reason: string
}

export type RecommendationRow = GeneratedRecommendation & {
  id: string
  status: RecommendationStatus
  firstSeenAt: Date
  updatedAt: Date
  completedAt: Date | null
}

/**
 * Every recommendation here is a conditional on a real fact from the signals
 * read model. Nothing is invented, and each one disappears when its condition
 * stops being true.
 */
export function generateRecommendations(signals: SecuritySignals): GeneratedRecommendation[] {
  const items: GeneratedRecommendation[] = []

  if (!signals.mfaEnabled) {
    items.push({
      key: 'platform_mfa',
      category: 'authentication',
      priority: 'high',
      title: 'Turn on two-step verification for Digital Guardian',
      detail:
        'Signing in would need your password plus a six-digit code from an authenticator app. If someone guesses your password, they still cannot get in.',
      actionLabel: 'Set it up now',
      actionHref: '/settings/security',
      learnHref: '/learn',
      weight: 15,
      reason: 'This account is currently protected by a password alone.',
    })
  }

  if (signals.accountCount === 0) {
    items.push({
      key: 'add_first_accounts',
      category: 'accounts',
      priority: 'medium',
      title: 'Add the accounts that matter most',
      detail:
        'Start with email and anything holding money or personal records. Digital Guardian only stores safe details - never a password.',
      actionLabel: 'Add an account',
      actionHref: '/accounts',
      weight: 12,
      reason: 'No accounts are tracked yet, so most of the safety score cannot be measured.',
    })
  } else {
    const unprotected = signals.accounts
      .filter((account) => !account.mfaEnabled)
      .sort(
        (a, b) =>
          (CATEGORY_CRITICALITY[b.category] ?? 2) - (CATEGORY_CRITICALITY[a.category] ?? 2) ||
          a.providerName.localeCompare(b.providerName),
      )
      .slice(0, 5)

    for (const account of unprotected) {
      items.push({
        key: `account_mfa:${account.id}`,
        category: 'accounts',
        priority: ['finance', 'email', 'government', 'work', 'school', 'health'].includes(account.category) ? 'high' : 'medium',
        title: `Add two-step verification to ${account.providerName}`,
        detail:
          account.category === 'email'
            ? 'Email is usually the reset route for every other account, so protecting it protects the rest.'
            : `A ${account.category} account that can be opened with a password alone is the easiest one to lose.`,
        actionLabel: 'Open the account record',
        actionHref: `/accounts/${account.id}`,
        learnHref: '/learn',
        weight: Math.min(8, CATEGORY_CRITICALITY[account.category] ?? 2) + 2,
        reason: 'This tracked account has no second sign-in step recorded.',
      })
    }

    if (!signals.recoveryEmail) {
      items.push({
        key: 'recovery_email',
        category: 'recovery',
        priority: 'high',
        title: 'Add a recovery email to this account',
        detail:
          'If you are ever locked out, a recovery address you can still reach is the difference between a nuisance and losing the account for good.',
        actionLabel: 'Add recovery details',
        actionHref: '/settings/security',
        weight: 12,
        reason: 'There is no backup way back into your Digital Guardian account.',
      })
    }

    const withoutRecovery = signals.accounts.filter((account) => !account.recoveryConfigured)
    if (withoutRecovery.length > 0) {
      items.push({
        key: 'account_recovery',
        category: 'recovery',
        priority: 'medium',
        title: `Record recovery options for ${withoutRecovery.length} account(s)`,
        detail:
          'Check what each service can send you if you lose access - a backup email, a phone number, or printed codes. Mark it once you have confirmed it works.',
        actionLabel: 'Review accounts',
        actionHref: '/accounts',
        weight: 8,
        reason: 'Some tracked accounts have no confirmed way back in.',
      })
    }

    if (signals.staleReviewedAccounts > 0) {
      items.push({
        key: 'review_stale_accounts',
        category: 'accounts',
        priority: 'medium',
        title: `Review ${signals.staleReviewedAccounts} account(s) past their check-in date`,
        detail:
          'Permissions quietly accumulate. A review means: what is connected to this account, what can see my details, and what I no longer use.',
        actionLabel: 'Start a review',
        actionHref: '/accounts',
        weight: 8,
        reason: 'Settings and app access drift, so old accounts go stale.',
      })
    }
  }

  if (signals.unreadCriticalAlerts + signals.unreadWarningAlerts > 0) {
    items.push({
      key: 'read_open_alerts',
      category: 'alerts',
      priority: 'high',
      title: 'Look at your unread security alerts',
      detail: `${signals.unreadCriticalAlerts} urgent and ${signals.unreadWarningAlerts} important alert(s) are waiting. Each one names what happened and what to do next.`,
      actionLabel: 'Open alerts',
      actionHref: '/alerts',
      weight: 10,
      reason: 'Unread alerts cannot be acted on.',
    })
  }

  if (signals.openIncidents > 0) {
    items.push({
      key: 'finish_open_incidents',
      category: 'incidents',
      priority: signals.openHighSeverityIncidents > 0 ? 'high' : 'medium',
      title: `Close out ${signals.openIncidents} open incident(s)`,
      detail:
        'Work through the recovery actions on each one, then record how it ended. A finished incident is a much harder problem to repeat.',
      actionLabel: 'Open incidents',
      actionHref: '/incidents',
      weight: 10,
      reason: 'Incidents still in progress keep risk open.',
    })
  }

  if (signals.checklistTotal > 0 && signals.checklistDone < signals.checklistTotal) {
    items.push({
      key: 'privacy_checklist',
      category: 'privacy',
      priority: signals.checklistDone === 0 ? 'medium' : 'low',
      title: `Finish ${signals.checklistTotal - signals.checklistDone} privacy check(s)`,
      detail:
        'Short, specific things you can confirm in a few minutes: what is public, what apps can see you, and what you no longer need.',
      actionLabel: 'Open privacy centre',
      actionHref: '/privacy',
      weight: 10,
      reason: 'Privacy settings were never checked at all.',
    })
  }

  if (signals.lessonsTotal > 0 && signals.lessonsCompleted === 0) {
    items.push({
      key: 'learning_first_lesson',
      category: 'learning',
      priority: 'medium',
      title: 'Take your first awareness lesson',
      detail:
        'Five minutes on how scam messages are put together. Recognising one is the cheapest protection there is.',
      actionLabel: 'Start learning',
      actionHref: '/learn',
      weight: 7,
      reason: 'No lessons completed yet.',
    })
  } else if (signals.suspiciousAnalysesLast30Days >= 1) {
    items.push({
      key: 'learning_phishing_followup',
      category: 'learning',
      priority: signals.suspiciousAnalysesLast30Days >= 3 ? 'high' : 'medium',
      title: 'You have seen suspicious links lately - reinforce the basics',
      detail:
        'A short refresher on the patterns behind these messages: urgency, a look-alike address, and a request that does not fit.',
      actionLabel: 'Review phishing',
      actionHref: '/learn?category=phishing',
      weight: 7,
      reason: `${signals.suspiciousAnalysesLast30Days} suspicious item(s) checked in the last 30 days.`,
    })
  }

  if (signals.failedLoginsLast24h >= 3) {
    items.push({
      key: 'review_sign_in_activity',
      category: 'sessions',
      priority: 'high',
      title: 'Check recent sign-in activity',
      detail:
        `${signals.failedLoginsLast24h} failed sign-in attempts in the last day. If they were not you, change the password and review active sessions.`,
      actionLabel: 'Review sessions',
      actionHref: '/settings/security',
      weight: 8,
      reason: 'Repeated failed sign-ins usually mean someone is guessing.',
    })
  }

  return items
}

/**
 * Engine owns generation, the user owns acknowledgement. An item that stops
 * being produced is completed for them; an item that comes back after being
 * fixed is reopened, because the condition is genuinely true again.
 */
export async function syncRecommendations(userId: string): Promise<GeneratedRecommendation[]> {
  const signals = await collectSignals(userId)
  const generated = generateRecommendations(signals)

  await transaction(async (client) => {
    for (const item of generated) {
      await client.query(
        `insert into recommendations
           (user_id, key, category, priority, title, detail, action_label, action_href, learn_href, status, weight, reason)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, $11)
         on conflict (user_id, key) do update
           set category = excluded.category,
               priority = excluded.priority,
               title = excluded.title,
               detail = excluded.detail,
               action_label = excluded.action_label,
               action_href = excluded.action_href,
               learn_href = excluded.learn_href,
               weight = excluded.weight,
               reason = excluded.reason,
               -- A dismissed item stays hidden for two weeks, then returns if still true.
               status = case
                 when recommendations.status = 'dismissed' and recommendations.dismissed_at > now() - interval '14 days'
                   then 'dismissed'
                 else 'open'
               end,
               completed_at = null,
               dismissed_at = case
                 when recommendations.status = 'dismissed' and recommendations.dismissed_at > now() - interval '14 days'
                   then recommendations.dismissed_at
                 else null
               end`,
        [
          userId,
          item.key,
          item.category,
          item.priority,
          item.title,
          item.detail,
          item.actionLabel,
          item.actionHref,
          item.learnHref ?? null,
          item.weight,
          item.reason,
        ],
      )
    }

    const keys = generated.length > 0 ? generated.map((item) => item.key) : ['__none__']
    const stale = await client.query<{ id: string; key: string }>(
      `select id, key from recommendations
        where user_id = $1 and status = 'open' and not (key = any ($2::text[]))`,
      [userId, keys],
    )

    for (const row of stale.rows) {
      await client.query(
        `update recommendations
            set status = 'completed', completed_at = now(), dismissed_at = null
          where id = $1`,
        [row.id],
      )
      await recordSecurityEvent({
        userId,
        category: 'recommendation',
        eventType: 'recommendation_auto_completed',
        message: `Marked "${row.key}" as done because the reason no longer applies.`,
        metadata: { key: row.key, mode: 'engine' },
      })
    }
  })

  return generated
}

export async function listRecommendations(
  userId: string,
  filters: { status?: RecommendationStatus; priority?: RecommendationPriority; category?: string } = {},
): Promise<RecommendationRow[]> {
  const conditions: string[] = ['user_id = $1']
  const params: unknown[] = [userId]

  if (filters.status) {
    params.push(filters.status)
    conditions.push(`status = $${params.length}`)
  }
  if (filters.priority) {
    params.push(filters.priority)
    conditions.push(`priority = $${params.length}`)
  }
  if (filters.category) {
    params.push(filters.category)
    conditions.push(`category = $${params.length}`)
  }

  const { rows } = await query<Record<string, unknown>>(
    `select id, key, category, priority, title, detail, action_label as "actionLabel",
            action_href as "actionHref", learn_href as "learnHref", status, weight, reason,
            first_seen_at as "firstSeenAt", updated_at as "updatedAt", completed_at as "completedAt"
       from recommendations
      where ${conditions.join(' and ')}
      order by
        case priority when 'high' then 1 when 'medium' then 2 else 3 end,
        weight desc,
        updated_at desc`,
    params,
  )

  return rows.map(toRow)
}

function toRow(row: Record<string, unknown>): RecommendationRow {
  return {
    id: String(row.id),
    key: String(row.key),
    category: row.category as RecommendationRow['category'],
    priority: row.priority as RecommendationPriority,
    title: String(row.title),
    detail: String(row.detail),
    actionLabel: String(row.actionLabel),
    actionHref: String(row.actionHref),
    learnHref: row.learnHref ? String(row.learnHref) : undefined,
    status: row.status as RecommendationStatus,
    weight: Number(row.weight),
    reason: String(row.reason),
    firstSeenAt: new Date(String(row.firstSeenAt)),
    updatedAt: new Date(String(row.updatedAt)),
    completedAt: row.completedAt ? new Date(String(row.completedAt)) : null,
  }
}

export async function setRecommendationStatus(
  userId: string,
  id: string,
  status: RecommendationStatus,
): Promise<RecommendationRow> {
  const existing = await queryOne<{ id: string; key: string; title: string; status: RecommendationStatus }>(
    'select id, key, title, status from recommendations where user_id = $1 and id = $2',
    [userId, id],
  )
  if (!existing) throw AppError.notFound('That recommendation is no longer here.')
  if (existing.status === status) return (await getRecommendation(userId, id))!

  await query(
    `update recommendations
        set status = $3,
            completed_at = case when $3 = 'completed' then now() else null end,
            dismissed_at = case when $3 = 'dismissed' then now() else null end
      where user_id = $1 and id = $2`,
    [userId, id, status],
  )

  await recordSecurityEvent({
    userId,
    category: 'recommendation',
    eventType: `recommendation_${status}`,
    message: `Marked "${existing.title}" as ${status}.`,
    metadata: { key: existing.key },
  })

  const updated = await getRecommendation(userId, id)
  if (!updated) throw AppError.notFound('That recommendation is no longer here.')
  return updated
}

async function getRecommendation(userId: string, id: string): Promise<RecommendationRow | null> {
  const row = await queryOne<Record<string, unknown>>(
    `select id, key, category, priority, title, detail, action_label as "actionLabel",
            action_href as "actionHref", learn_href as "learnHref", status, weight, reason,
            first_seen_at as "firstSeenAt", updated_at as "updatedAt", completed_at as "completedAt"
       from recommendations
      where user_id = $1 and id = $2`,
    [userId, id],
  )
  return row ? toRow(row) : null
}

/**
 * Called after any change that can move the needle: recalculate, then re-derive
 * advice, so the dashboard and the advice cannot drift apart.
 */
export async function refreshAssessment(userId: string, trigger: AssessmentTrigger) {
  const score = await recalculate(userId, trigger)
  const recommendations = await syncRecommendations(userId)
  return { score, recommendations }
}
