import { collectSignals, fingerprintSignals } from './signals'
import { getStoredScore, type StoredScore } from './score.service'
import { listRecommendations, refreshAssessment, syncRecommendations, type RecommendationRow } from './recommendation.service'
import { listNotifications, unreadNotificationCount } from './notification.service'
import { listSecurityEvents } from './audit.service'
import { listAnalyses } from './analysis.service'
import { listSessions } from './session.service'
import { accountSummary } from './digital-account.service'

export type DashboardView = {
  score: StoredScore
  status: { band: StoredScore['band']; headline: string; attentionCount: number }
  priorityActions: RecommendationRow[]
  alerts: Awaited<ReturnType<typeof listNotifications>>
  unreadAlerts: number
  recentActivity: Awaited<ReturnType<typeof listSecurityEvents>>
  latestCheck: Awaited<ReturnType<typeof listAnalyses>>[number] | null
  accounts: Awaited<ReturnType<typeof accountSummary>>
  activeSessions: number
  signals: {
    mfaEnabled: boolean
    emailVerified: boolean
    hasRecoveryEmail: boolean
    checklistDone: number
    checklistTotal: number
    lessonsCompleted: number
    lessonsTotal: number
    openIncidents: number
  }
}

/**
 * The dashboard is one request because it is one question: "am I okay, and what
 * should I do next?" Every number below comes from the same signals read model
 * that produced the score, so the page can never contradict itself.
 */
export async function getDashboard(userId: string, currentSessionId: string | null): Promise<DashboardView> {
  const signals = await collectSignals(userId)
  const stored = await getStoredScore(userId)

  // Nothing is recomputed while the stored score still matches the inputs, so a
  // dashboard view is never a guess and never a stale number either.
  let score: StoredScore
  if (stored && stored.fingerprint === fingerprintSignals(signals)) {
    await syncRecommendations(userId)
    score = stored
  } else {
    score = (await refreshAssessment(userId, 'periodic')).score
  }

  const [open, alerts, unread, events, analyses, accounts, sessions] = await Promise.all([
    listRecommendations(userId, { status: 'open' }),
    listNotifications({ userId, filter: 'unread', kind: 'security_alert', limit: 5 }),
    unreadNotificationCount(userId),
    listSecurityEvents({ userId, limit: 6 }),
    listAnalyses(userId, 1),
    accountSummary(userId),
    listSessions(userId, currentSessionId),
  ])

  return {
    score,
    status: { band: score.band, headline: score.headline, attentionCount: score.attentionCount },
    priorityActions: open.slice(0, 4),
    alerts,
    unreadAlerts: unread,
    recentActivity: events,
    latestCheck: analyses[0] ?? null,
    accounts,
    activeSessions: sessions.length,
    signals: {
      mfaEnabled: signals.mfaEnabled,
      emailVerified: signals.emailVerified,
      hasRecoveryEmail: Boolean(signals.recoveryEmail),
      checklistDone: signals.checklistDone,
      checklistTotal: signals.checklistTotal,
      lessonsCompleted: signals.lessonsCompleted,
      lessonsTotal: signals.lessonsTotal,
      openIncidents: signals.openIncidents,
    },
  }
}
