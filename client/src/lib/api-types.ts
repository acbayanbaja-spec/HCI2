export type ApiErrorCode =
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'account_locked'
  | 'mfa_required'
  | 'mfa_pending'
  | 'invalid_credentials'
  | 'token_invalid'
  | 'token_expired'
  | 'db_unavailable'
  | 'internal_error'

export type ApiIssue = { field: string; message: string }

export type Role = 'user' | 'admin'

export type PublicUser = {
  id: string
  email: string
  displayName: string
  role: Role
  status: string
  emailVerified: boolean
  mfaEnabled: boolean
  lastLoginAt: string | null
  createdAt: string
}

export type LoginPolicy = {
  minPasswordLength: number
  maxFailedLogins: number
  accountLockMinutes: number
  accessTokenTtlSeconds: number
  mailDelivery: 'outbox' | 'smtp'
}

export type LoginSuccess = {
  authenticated: true
  mfaRequired: false
  user: PublicUser
  sessionId: string
  csrfToken: string
}

export type LoginMfaRequired = {
  authenticated: false
  mfaRequired: true
  sessionId: string
  displayName: string
  message: string
}

export type RegisterResult = {
  user: PublicUser
  verificationRequired: boolean
  message: string
}

export type ScoreBand = 'critical' | 'at_risk' | 'fair' | 'protected' | 'strong'
export type FactorStatus = 'satisfied' | 'partial' | 'failing' | 'not_applicable'

export type ScoreFactor = {
  key: string
  label: string
  weight: number
  earned: number
  deducted: number
  status: FactorStatus
  reason: string
  actionHref: string | null
}

export type ScoreResult = {
  score: number
  band: ScoreBand
  headline: string
  attentionCount: number
  factors: ScoreFactor[]
  fingerprint: string
  modelVersion: number
  computedAt: string
}

export type ScoreResponse = ScoreResult & { howItWorks: string[] }

export type ScoreHistoryEntry = {
  id: string
  score: number
  band: string
  trigger: string
  createdAt: string
}

export type RecommendationPriority = 'high' | 'medium' | 'low'
export type RecommendationStatus = 'open' | 'completed' | 'dismissed'
export type RecommendationCategory =
  | 'authentication'
  | 'accounts'
  | 'recovery'
  | 'alerts'
  | 'learning'
  | 'privacy'
  | 'incidents'
  | 'sessions'

export type Recommendation = {
  id: string
  key: string
  category: RecommendationCategory
  priority: RecommendationPriority
  title: string
  detail: string
  actionLabel: string
  actionHref: string
  learnHref: string | null
  weight: number
  reason: string
  status: RecommendationStatus
  firstSeenAt: string
  updatedAt: string
  completedAt: string | null
}

export type AccountCategory =
  | 'email'
  | 'social'
  | 'school'
  | 'work'
  | 'finance'
  | 'shopping'
  | 'health'
  | 'government'
  | 'entertainment'
  | 'developer'
  | 'other'

export type AccountMfaMethod = 'none' | 'authenticator_app' | 'sms' | 'security_key' | 'passkey'

export type DigitalAccount = {
  id: string
  providerName: string
  category: AccountCategory
  usernameHint: string | null
  signInUrl: string | null
  mfaEnabled: boolean
  mfaMethod: string
  storedInPasswordManager: boolean
  uniquePasswordClaimed: boolean
  recoveryConfigured: boolean
  reportedBreached: boolean
  reviewIntervalDays: number
  lastReviewedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  daysSinceReview: number | null
  needsReview: boolean
}

export type AccountInput = {
  providerName: string
  category: AccountCategory
  usernameHint: string | null
  signInUrl: string | null
  mfaEnabled: boolean
  mfaMethod: AccountMfaMethod
  storedInPasswordManager: boolean
  uniquePasswordClaimed: boolean
  recoveryConfigured: boolean
  reportedBreached: boolean
  reviewIntervalDays: number
  notes: string | null
}

export type AccountMeta = { categories: AccountCategory[]; mfaMethods: AccountMfaMethod[] }

export type AccountSummary = {
  total: number
  withMfa: number
  needsReview: number
  reportedBreached: number
  notInPasswordManager: number
}

export type IndicatorSeverity = 'info' | 'caution' | 'warning' | 'critical'
export type AnalysisVerdict = 'low' | 'caution' | 'suspicious' | 'high'
export type AnalysisKind = 'url' | 'message' | 'email'

export type Indicator = {
  code: string
  label: string
  severity: IndicatorSeverity
  detail: string
  advice: string
  weight: number
}

export type AnalysisResult = {
  id: string
  inputKind: AnalysisKind
  verdict: AnalysisVerdict
  riskScore: number
  indicators: Indicator[]
  guidance: string[]
  linksFound: string[]
  engineVersion: number
  createdAt: string
  disclaimer: string
}

export type AnalysisHistoryItem = {
  id: string
  inputKind: AnalysisKind
  inputExcerpt: string
  verdict: AnalysisVerdict
  riskScore: number
  createdAt: string
}

export type ReportStatus = string

export type ContentReport = {
  id: string
  target: string
  status: ReportStatus
  claimedBrand: string | null
  adminNotes: string | null
  createdAt: string
  reviewedAt: string | null
}

export type SessionInfo = {
  id: string
  deviceLabel: string
  browser: string | null
  os: string | null
  platform: string | null
  isCurrent: boolean
  signedInWithMfa: boolean
  createdAt: string
  lastSeenAt: string
  expiresAt: string
}

export type SessionsSummary = {
  total: number
  current: number
  mobile: number
  signedInWithMfa: number
}

export type NotificationKind = 'security_alert' | 'recommendation' | 'report_update' | 'learning' | 'emergency' | 'system'

export type NotificationItem = {
  id: string
  kind: NotificationKind
  severity: IndicatorSeverity
  title: string
  body: string
  link: string | null
  read: boolean
  archived: boolean
  createdAt: string
}

export type SecurityEvent = {
  id: string
  category: string
  eventType: string
  message: string
  severity: IndicatorSeverity
  createdAt: string
  metadata: Record<string, unknown> | null
}

export type NotificationPreferences = {
  securityAlerts: boolean
  recommendationDigests: boolean
  reportUpdates: boolean
  learningNudges: boolean
  emergencyReminders: boolean
}

export type ThemePreference = 'system' | 'light' | 'dark'

export type Profile = {
  displayName: string
  email: string
  role: Role
  emailVerified: boolean
  mfaEnabled: boolean
  createdAt: string
  lastLoginAt: string | null
  fullName: string | null
  preferredName: string | null
  phone: string | null
  recoveryEmail: string | null
  timezone: string
  locale: string
  theme: ThemePreference
  notifications: NotificationPreferences
  privacyNote: string
}

export type MfaSetup = {
  otpauthUri: string
  manualCode: string
  accountLabel: string
  issuer: string
  steps: string[]
}

export type Dashboard = {
  score: ScoreResult
  status: { band: ScoreBand; headline: string; attentionCount: number }
  priorityActions: Recommendation[]
  alerts: NotificationItem[]
  unreadAlerts: number
  recentActivity: SecurityEvent[]
  latestCheck: AnalysisHistoryItem | null
  accounts: AccountSummary
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

export type MessageResult = { message?: string }
