import { describe, expect, it } from 'vitest'
import { computeScore } from '../src/services/score.service'
import { generateRecommendations } from '../src/services/recommendation.service'
import { fingerprintSignals, type AccountSignal, type SecuritySignals } from '../src/services/signals'

const TOTAL_WEIGHT = 100

function account(overrides: Partial<AccountSignal> = {}): AccountSignal {
  return {
    id: 'acc-1',
    providerName: 'Gmail',
    category: 'email',
    mfaEnabled: true,
    mfaMethod: 'authenticator_app',
    storedInPasswordManager: true,
    recoveryConfigured: true,
    reportedBreached: false,
    lastReviewedAt: new Date(),
    reviewIntervalDays: 90,
    ...overrides,
  }
}

function signals(overrides: Partial<SecuritySignals> = {}): SecuritySignals {
  return {
    userId: 'user-1',
    mfaEnabled: true,
    emailVerified: true,
    recoveryEmail: 'backup@example.com',
    accountCount: 1,
    accounts: [account()],
    unreviewedAccounts: 0,
    staleReviewedAccounts: 0,
    checklistTotal: 14,
    checklistDone: 14,
    lessonsTotal: 10,
    lessonsCompleted: 10,
    unreadCriticalAlerts: 0,
    unreadWarningAlerts: 0,
    openIncidents: 0,
    openHighSeverityIncidents: 0,
    suspiciousAnalysesLast30Days: 0,
    failedLoginsLast24h: 0,
    activeSessions: 1,
    ...overrides,
  }
}

describe('digital safety score', () => {
  it('is deterministic: the same inputs give the same number and the same factors', () => {
    const input = signals()
    const first = computeScore(input)
    const second = computeScore(input)
    expect(second).toEqual(first)
    expect(fingerprintSignals(input)).toBe(fingerprintSignals(structuredClone(input)))
  })

  it('stays inside the 0 to 100 range for every shape of account', () => {
    const variants = [
      signals(),
      signals({ mfaEnabled: false, emailVerified: false, recoveryEmail: null, accountCount: 0, accounts: [], checklistTotal: 0, checklistDone: 0, lessonsTotal: 0, lessonsCompleted: 0 }),
      signals({
        unreadCriticalAlerts: 9,
        openIncidents: 4,
        openHighSeverityIncidents: 3,
        suspiciousAnalysesLast30Days: 8,
        failedLoginsLast24h: 20,
        accounts: [account({ mfaEnabled: false, reportedBreached: true, lastReviewedAt: null })],
        unreviewedAccounts: 1,
      }),
    ]
    for (const variant of variants) {
      const result = computeScore(variant)
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(100)
    }
  })

  it('gives full credit to a well-kept account', () => {
    const result = computeScore(signals())
    expect(result.score).toBeGreaterThanOrEqual(95)
    expect(result.band).toBe('strong')
    expect(result.attentionCount).toBe(0)
  })

  it('marks a factor not applicable instead of guessing, and renormalises the rest', () => {
    const noAccounts = computeScore(signals({ accountCount: 0, accounts: [], unreviewedAccounts: 0, staleReviewedAccounts: 0 }))
    const coverage = noAccounts.factors.find((factor) => factor.key === 'account_mfa_coverage')
    expect(coverage?.status).toBe('not_applicable')

    // The weights still add up to the full model, but the denominator drops the
    // factors that had nothing to measure.
    const applicable = noAccounts.factors.filter((factor) => factor.status !== 'not_applicable')
    expect(applicable.reduce((sum, factor) => sum + factor.weight, 0)).toBeLessThan(TOTAL_WEIGHT)
    expect(noAccounts.score).toBe(Math.round((applicable.reduce((sum, f) => sum + f.earned, 0) / applicable.reduce((sum, f) => sum + f.weight, 0)) * 100))
  })

  it('moves when a real protection is added, and only then', () => {
    const before = computeScore(signals({ mfaEnabled: false }))
    const after = computeScore(signals({ mfaEnabled: true }))
    expect(after.score).toBeGreaterThan(before.score)

    // Renaming something must not change the number.
    expect(computeScore(signals({ userId: 'someone-else' })).score).toBe(after.score)
  })

  it('explains every factor in plain language with a place to act', () => {
    for (const factor of computeScore(signals({ mfaEnabled: false, checklistDone: 3 })).factors) {
      expect(factor.reason.trim().length).toBeGreaterThan(20)
      expect(['satisfied', 'partial', 'failing', 'not_applicable']).toContain(factor.status)
      expect(factor.earned).toBeLessThanOrEqual(factor.weight)
    }
  })

  it('treats unresolved critical alerts and open incidents as real risk', () => {
    const calm = computeScore(signals())
    const worried = computeScore(signals({ unreadCriticalAlerts: 3, openHighSeverityIncidents: 2 }))
    expect(worried.score).toBeLessThan(calm.score)
  })
})

describe('adaptive recommendations', () => {
  it('derives nothing that the signals do not support', () => {
    const items = generateRecommendations(signals())
    expect(items.every((item) => item.title && item.detail && item.actionHref && item.reason)).toBe(true)
    expect(items.find((item) => item.key === 'platform_mfa')).toBeUndefined()
  })

  it('asks for two-step verification only while it is missing', () => {
    const items = generateRecommendations(signals({ mfaEnabled: false }))
    const mfa = items.find((item) => item.key === 'platform_mfa')
    expect(mfa?.priority).toBe('high')
    expect(generateRecommendations(signals({ mfaEnabled: true })).find((item) => item.key === 'platform_mfa')).toBeUndefined()
  })

  it('puts a money account without two-step verification at the top', () => {
    const items = generateRecommendations(
      signals({
        accounts: [account({ providerName: 'Bank of the Philippines', category: 'finance', mfaEnabled: false, mfaMethod: 'none' })],
        unreviewedAccounts: 1,
      }),
    )
    expect(items[0]?.priority).toBe('high')
    expect(items.some((item) => item.category === 'accounts')).toBe(true)
  })

  it('sorts high before low', () => {
    const items = generateRecommendations(
      signals({ mfaEnabled: false, lessonsCompleted: 0, checklistDone: 0, recoveryEmail: null, accounts: [] , accountCount: 0 }),
    )
    const rank = { high: 0, medium: 1, low: 2 } as const
    const ordered = items.map((item) => rank[item.priority])
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b))
  })
})
