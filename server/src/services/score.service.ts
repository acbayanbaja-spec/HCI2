import { query, queryOne } from '../db/pool'
import { CATEGORY_CRITICALITY, collectSignals, fingerprintSignals, type SecuritySignals } from './signals'

export type FactorStatus = 'satisfied' | 'partial' | 'failing' | 'not_applicable'

export type ScoreFactor = {
  key: string
  label: string
  weight: number
  earned: number
  deducted: number
  status: FactorStatus
  /** Plain language: why this factor looks the way it does. */
  reason: string
  actionHref: string | null
}

export type ScoreResult = {
  score: number
  band: 'critical' | 'at_risk' | 'fair' | 'protected' | 'strong'
  headline: string
  attentionCount: number
  factors: ScoreFactor[]
  fingerprint: string
  modelVersion: number
}

export const MODEL_VERSION = 1

/** Weights sum to 100. Each factor is independently explainable. */
const WEIGHTS = {
  platformMfa: 15,
  accountMfaCoverage: 20,
  recoveryReadiness: 12,
  alertHygiene: 10,
  privacyChecklist: 10,
  learningProgress: 7,
  reviewFreshness: 8,
  incidentHygiene: 10,
  riskExposure: 8,
} as const

function bandFor(score: number): ScoreResult['band'] {
  if (score >= 90) return 'strong'
  if (score >= 75) return 'protected'
  if (score >= 55) return 'fair'
  if (score >= 35) return 'at_risk'
  return 'critical'
}

const HEADLINES: Record<ScoreResult['band'], string> = {
  strong: 'You are well protected.',
  protected: 'You are in good shape.',
  fair: 'You are covered in the basics, with gaps to close.',
  at_risk: 'There are a few real gaps worth closing soon.',
  critical: 'Your accounts are exposed. Start with the highest priority item.',
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function ratioToPercent(ratio: number): number {
  return Math.max(0, Math.min(1, ratio))
}

/**
 * The whole model lives here, in one pure function, so a score can be reproduced
 * from the same facts and defended in a viva.
 */
export function computeScore(signals: SecuritySignals): ScoreResult {
  const factors: ScoreFactor[] = []

  // 1. The user's own Digital Guardian account protection.
  factors.push(
    signals.mfaEnabled
      ? {
          key: 'platform_mfa',
          label: 'Two-step verification on Digital Guardian',
          weight: WEIGHTS.platformMfa,
          earned: WEIGHTS.platformMfa,
          deducted: 0,
          status: 'satisfied',
          reason: 'A second step is required to sign in here, so a stolen password alone is not enough.',
          actionHref: null,
        }
      : {
          key: 'platform_mfa',
          label: 'Two-step verification on Digital Guardian',
          weight: WEIGHTS.platformMfa,
          earned: 0,
          deducted: WEIGHTS.platformMfa,
          status: 'failing',
          reason: 'Only a password protects this account. Adding a second step is the single quickest win.',
          actionHref: '/settings/security',
        },
  )

  // 2. MFA coverage across the accounts the user tracks, weighted by how much
  //    damage a compromise there would do.
  if (signals.accountCount === 0) {
    factors.push({
      key: 'account_mfa_coverage',
      label: 'Two-step verification on your other accounts',
      weight: WEIGHTS.accountMfaCoverage,
      earned: 0,
      deducted: 0,
      status: 'not_applicable',
      reason: 'No accounts added yet, so there is nothing to measure here. This is not counted against you.',
      actionHref: '/accounts',
    })
  } else {
    const totalCriticality = signals.accounts.reduce((sum, a) => sum + (CATEGORY_CRITICALITY[a.category] ?? 2), 0)
    const protectedCriticality = signals.accounts
      .filter((a) => a.mfaEnabled)
      .reduce((sum, a) => sum + (CATEGORY_CRITICALITY[a.category] ?? 2), 0)
    const ratio = totalCriticality === 0 ? 0 : protectedCriticality / totalCriticality
    const earned = round2(ratio * WEIGHTS.accountMfaCoverage)
    const unprotected = signals.accounts.filter((a) => !a.mfaEnabled).length
    factors.push({
      key: 'account_mfa_coverage',
      label: 'Two-step verification on your other accounts',
      weight: WEIGHTS.accountMfaCoverage,
      earned,
      deducted: round2(WEIGHTS.accountMfaCoverage - earned),
      status: ratio >= 0.9 ? 'satisfied' : ratio >= 0.5 ? 'partial' : 'failing',
      reason:
        unprotected === 0
          ? 'Every account you track has a second step. That is the strongest position to be in.'
          : `${unprotected} of ${signals.accountCount} tracked accounts can still be opened with a password alone.`,
      actionHref: '/accounts',
    })
  }

  // 3. Recovery options - the difference between a scare and a permanent loss.
  {
    const platformRecovery = signals.recoveryEmail ? 1 : 0
    const accountRecoveryRatio =
      signals.accountCount === 0 ? 0 : signals.accounts.filter((a) => a.recoveryConfigured).length / signals.accountCount
    const earned = round2(WEIGHTS.recoveryReadiness * (0.6 * platformRecovery + 0.4 * accountRecoveryRatio))
    factors.push({
      key: 'recovery_readiness',
      label: 'Recovery options',
      weight: WEIGHTS.recoveryReadiness,
      earned,
      deducted: round2(WEIGHTS.recoveryReadiness - earned),
      status: earned >= WEIGHTS.recoveryReadiness * 0.9 ? 'satisfied' : earned >= WEIGHTS.recoveryReadiness * 0.4 ? 'partial' : 'failing',
      reason: !signals.recoveryEmail
        ? 'Add a recovery email so a locked account can be got back without losing it.'
        : accountRecoveryRatio < 1
          ? 'Your recovery email is set. Some tracked accounts still have no way back if you are locked out.'
          : 'Recovery options are recorded for this account and everything you track.',
      actionHref: '/settings/security',
    })
  }

  // 4. Unresolved security alerts.
  {
    const deductions = Math.min(WEIGHTS.alertHygiene, signals.unreadCriticalAlerts * 8 + signals.unreadWarningAlerts * 4)
    const earned = WEIGHTS.alertHygiene - deductions
    factors.push({
      key: 'alert_hygiene',
      label: 'Security alerts',
      weight: WEIGHTS.alertHygiene,
      earned,
      deducted: deductions,
      status: deductions === 0 ? 'satisfied' : earned > 0 ? 'partial' : 'failing',
      reason:
        deductions === 0
          ? 'Nothing is waiting for you in your alert inbox.'
          : `${signals.unreadCriticalAlerts} urgent and ${signals.unreadWarningAlerts} important alert(s) have not been looked at yet.`,
      actionHref: '/alerts',
    })
  }

  // 5. Privacy checklist completion.
  if (signals.checklistTotal === 0) {
    factors.push({
      key: 'privacy_checklist',
      label: 'Privacy checklist',
      weight: WEIGHTS.privacyChecklist,
      earned: 0,
      deducted: 0,
      status: 'not_applicable',
      reason: 'No privacy checklist is published yet, so this is left out of the score.',
      actionHref: '/privacy',
    })
  } else {
    const ratio = ratioToPercent(signals.checklistDone / signals.checklistTotal)
    const earned = round2(ratio * WEIGHTS.privacyChecklist)
    factors.push({
      key: 'privacy_checklist',
      label: 'Privacy checklist',
      weight: WEIGHTS.privacyChecklist,
      earned,
      deducted: round2(WEIGHTS.privacyChecklist - earned),
      status: ratio >= 0.9 ? 'satisfied' : ratio >= 0.4 ? 'partial' : 'failing',
      reason:
        ratio >= 0.9
          ? 'You have worked through the privacy checklist.'
          : `${signals.checklistDone} of ${signals.checklistTotal} privacy checks are done.`,
      actionHref: '/privacy',
    })
  }

  // 6. Learning progress - awareness is a control, not a bonus.
  if (signals.lessonsTotal === 0) {
    factors.push({
      key: 'learning_progress',
      label: 'Security awareness',
      weight: WEIGHTS.learningProgress,
      earned: 0,
      deducted: 0,
      status: 'not_applicable',
      reason: 'No lessons are published yet, so this is left out of the score.',
      actionHref: '/learn',
    })
  } else {
    const ratio = ratioToPercent(signals.lessonsCompleted / signals.lessonsTotal)
    const earned = round2(ratio * WEIGHTS.learningProgress)
    factors.push({
      key: 'learning_progress',
      label: 'Security awareness',
      weight: WEIGHTS.learningProgress,
      earned,
      deducted: round2(WEIGHTS.learningProgress - earned),
      status: ratio >= 0.8 ? 'satisfied' : ratio > 0 ? 'partial' : 'failing',
      reason:
        ratio >= 0.8
          ? 'You have completed most of the available lessons.'
          : `${signals.lessonsCompleted} of ${signals.lessonsTotal} lessons completed. Recognising a scam is a security control.`,
      actionHref: '/learn',
    })
  }

  // 7. How recent the last review of each account was.
  if (signals.accountCount === 0) {
    factors.push({
      key: 'review_freshness',
      label: 'Account review freshness',
      weight: WEIGHTS.reviewFreshness,
      earned: 0,
      deducted: 0,
      status: 'not_applicable',
      reason: 'Nothing tracked yet, so there is no review history to judge.',
      actionHref: '/accounts',
    })
  } else {
    const fresh = signals.accountCount - signals.staleReviewedAccounts
    const ratio = ratioToPercent(fresh / signals.accountCount)
    const earned = round2(ratio * WEIGHTS.reviewFreshness)
    factors.push({
      key: 'review_freshness',
      label: 'Account review freshness',
      weight: WEIGHTS.reviewFreshness,
      earned,
      deducted: round2(WEIGHTS.reviewFreshness - earned),
      status: ratio >= 0.9 ? 'satisfied' : ratio >= 0.5 ? 'partial' : 'failing',
      reason:
        signals.staleReviewedAccounts === 0
          ? 'Every tracked account has been looked at recently.'
          : `${signals.staleReviewedAccounts} account(s) have gone past their review date. Settings and app access drift over time.`,
      actionHref: '/accounts',
    })
  }

  // 8. Open incidents - phrased as "under control", never as blame.
  {
    const earned =
      signals.openIncidents === 0
        ? WEIGHTS.incidentHygiene
        : signals.openHighSeverityIncidents > 0
          ? 0
          : round2(WEIGHTS.incidentHygiene * 0.5)
    factors.push({
      key: 'incident_hygiene',
      label: 'Incidents under control',
      weight: WEIGHTS.incidentHygiene,
      earned,
      deducted: round2(WEIGHTS.incidentHygiene - earned),
      status: earned >= WEIGHTS.incidentHygiene ? 'satisfied' : earned > 0 ? 'partial' : 'failing',
      reason:
        signals.openIncidents === 0
          ? 'No incidents are open, so nothing is waiting to be finished.'
          : `${signals.openIncidents} incident(s) are still open${signals.openHighSeverityIncidents > 0 ? `, including ${signals.openHighSeverityIncidents} urgent` : ''}. Working through the recovery steps lifts this.`,
      actionHref: '/incidents',
    })
  }

  // 9. Recent exposure to suspicious content.
  {
    const count = signals.suspiciousAnalysesLast30Days
    const ratio = count === 0 ? 1 : count <= 2 ? 0.7 : 0.4
    const earned = round2(ratio * WEIGHTS.riskExposure)
    factors.push({
      key: 'risk_exposure',
      label: 'Exposure to suspicious content',
      weight: WEIGHTS.riskExposure,
      earned,
      deducted: round2(WEIGHTS.riskExposure - earned),
      status: ratio === 1 ? 'satisfied' : ratio >= 0.6 ? 'partial' : 'failing',
      reason:
        count === 0
          ? 'Nothing you checked in the last 30 days came back as suspicious.'
          : `${count} item(s) you checked recently looked suspicious. Slowing down before clicking is the protection that works.`,
      actionHref: '/check-link',
    })
  }

  // Renormalise over what we can actually judge, so missing data never inflates
  // or silently deflates the result.
  const applicable = factors.filter((factor) => factor.status !== 'not_applicable')
  const weightSum = applicable.reduce((sum, factor) => sum + factor.weight, 0)
  const earnedSum = applicable.reduce((sum, factor) => sum + factor.earned, 0)
  const score = weightSum === 0 ? 0 : Math.round((earnedSum / weightSum) * 100)
  const band = bandFor(score)

  return {
    score,
    band,
    headline: HEADLINES[band],
    attentionCount: factors.filter((factor) => factor.status === 'failing' || factor.status === 'partial').length,
    factors,
    fingerprint: fingerprintSignals(signals),
    modelVersion: MODEL_VERSION,
  }
}

export type StoredScore = ScoreResult & { computedAt: Date }

export type AssessmentTrigger =
  | 'signup'
  | 'account_created'
  | 'account_updated'
  | 'review_logged'
  | 'checklist_updated'
  | 'learning_completed'
  | 'recommendation_updated'
  | 'incident_updated'
  | 'alerts_reviewed'
  | 'analysis_run'
  | 'mfa_updated'
  | 'manual'
  | 'periodic'

export async function recalculate(userId: string, trigger: AssessmentTrigger): Promise<StoredScore> {
  const signals = await collectSignals(userId)
  const result = computeScore(signals)

  await query(
    `insert into security_scores
       (user_id, score, band, headline, attention_count, factors, input_fingerprint, model_version, computed_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())
     on conflict (user_id) do update
       set score = excluded.score,
           band = excluded.band,
           headline = excluded.headline,
           attention_count = excluded.attention_count,
           factors = excluded.factors,
           input_fingerprint = excluded.input_fingerprint,
           model_version = excluded.model_version,
           computed_at = now()`,
    [userId, result.score, result.band, result.headline, result.attentionCount, JSON.stringify(result.factors), result.fingerprint, result.modelVersion],
  )

  await query(
    `insert into security_assessments (user_id, score, band, factors, trigger_source)
     values ($1, $2, $3, $4::jsonb, $5)`,
    [userId, result.score, result.band, JSON.stringify(result.factors), trigger],
  )

  return { ...result, computedAt: new Date() }
}

export async function getStoredScore(userId: string): Promise<StoredScore | null> {
  const row = await queryOne<{
    score: number
    band: ScoreResult['band']
    headline: string
    attention_count: number
    factors: ScoreFactor[]
    input_fingerprint: string
    model_version: number
    computed_at: Date
  }>(
    `select score, band, headline, attention_count, factors, input_fingerprint, model_version, computed_at
       from security_scores
      where user_id = $1`,
    [userId],
  )

  if (!row) return null
  return {
    score: row.score,
    band: row.band,
    headline: row.headline,
    attentionCount: row.attention_count,
    factors: row.factors,
    fingerprint: row.input_fingerprint,
    modelVersion: row.model_version,
    computedAt: row.computed_at,
  }
}

export async function scoreHistory(userId: string, limit = 20) {
  const { rows } = await query<{
    id: string
    score: number
    band: string
    trigger: AssessmentTrigger
    createdAt: Date
  }>(
    `select id, score, band, trigger_source as "trigger", created_at as "createdAt"
       from security_assessments
      where user_id = $1
      order by created_at desc
      limit $2`,
    [userId, Math.min(Math.max(limit, 1), 100)],
  )
  return rows
}
