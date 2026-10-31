import { AppError } from '../lib/errors'
import { query, queryOne } from '../db/pool'
import { recordSecurityEvent } from './audit.service'
import { refreshAssessment } from './recommendation.service'

export const ACCOUNT_CATEGORIES = [
  'email',
  'social',
  'school',
  'work',
  'finance',
  'shopping',
  'health',
  'government',
  'entertainment',
  'developer',
  'other',
] as const

export const MFA_METHODS = ['none', 'authenticator_app', 'sms', 'security_key', 'passkey'] as const

export type DigitalAccount = {
  id: string
  providerName: string
  category: (typeof ACCOUNT_CATEGORIES)[number]
  usernameHint: string | null
  signInUrl: string | null
  mfaEnabled: boolean
  mfaMethod: string
  storedInPasswordManager: boolean
  uniquePasswordClaimed: boolean
  recoveryConfigured: boolean
  reportedBreached: boolean
  reviewIntervalDays: number
  lastReviewedAt: Date | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
  /** Derived, never stored: how long since this account was last looked at. */
  daysSinceReview: number | null
  needsReview: boolean
}

type AccountRow = {
  id: string
  provider_name: string
  category: string
  username_hint: string | null
  sign_in_url: string | null
  mfa_enabled: boolean
  mfa_method: string
  stored_in_password_manager: boolean
  unique_password_claimed: boolean
  recovery_configured: boolean
  reported_breached: boolean
  review_interval_days: number
  last_reviewed_at: Date | null
  notes: string | null
  created_at: Date
  updated_at: Date
}

const SELECT = `select id, provider_name, category, username_hint, sign_in_url, mfa_enabled, mfa_method,
                       stored_in_password_manager, unique_password_claimed, recovery_configured,
                       reported_breached, review_interval_days, last_reviewed_at, notes, created_at, updated_at
                  from digital_accounts`

function toAccount(row: AccountRow): DigitalAccount {
  // Clamped because the database clock can be a few ms ahead of the app clock,
  // and "reviewed -1 days ago" is not a thing a user can act on.
  const daysSinceReview = row.last_reviewed_at
    ? Math.max(0, Math.floor((Date.now() - row.last_reviewed_at.getTime()) / 86_400_000))
    : null
  return {
    id: row.id,
    providerName: row.provider_name,
    category: row.category as DigitalAccount['category'],
    usernameHint: row.username_hint,
    signInUrl: row.sign_in_url,
    mfaEnabled: row.mfa_enabled,
    mfaMethod: row.mfa_method,
    storedInPasswordManager: row.stored_in_password_manager,
    uniquePasswordClaimed: row.unique_password_claimed,
    recoveryConfigured: row.recovery_configured,
    reportedBreached: row.reported_breached,
    reviewIntervalDays: row.review_interval_days,
    lastReviewedAt: row.last_reviewed_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    daysSinceReview,
    needsReview: daysSinceReview === null || daysSinceReview >= row.review_interval_days,
  }
}

export async function listAccounts(userId: string, category?: string): Promise<DigitalAccount[]> {
  const rows = category
    ? await query<AccountRow>(`${SELECT} where user_id = $1 and category = $2 order by created_at desc`, [userId, category])
    : await query<AccountRow>(`${SELECT} where user_id = $1 order by created_at desc`, [userId])
  return rows.rows.map(toAccount)
}

export async function getAccount(userId: string, id: string): Promise<DigitalAccount> {
  const row = await queryOne<AccountRow>(`${SELECT} where user_id = $1 and id = $2`, [userId, id])
  if (!row) throw AppError.notFound('That account is not in your list.')
  return toAccount(row)
}

export type AccountInput = {
  providerName: string
  category?: (typeof ACCOUNT_CATEGORIES)[number]
  usernameHint?: string | null
  signInUrl?: string | null
  mfaEnabled?: boolean
  mfaMethod?: string
  storedInPasswordManager?: boolean
  uniquePasswordClaimed?: boolean
  recoveryConfigured?: boolean
  reportedBreached?: boolean
  reviewIntervalDays?: number
  notes?: string | null
}

/**
 * There is no password field here by design. A masked hint is the most the
 * platform ever keeps about an outside account.
 */
export async function createAccount(userId: string, input: AccountInput): Promise<DigitalAccount> {
  assertMfaConsistent(input)

  const row = await queryOne<AccountRow>(
    `insert into digital_accounts
       (user_id, provider_name, category, username_hint, sign_in_url, mfa_enabled, mfa_method,
        stored_in_password_manager, unique_password_claimed, recovery_configured, reported_breached,
        review_interval_days, notes, last_reviewed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
     returning id, provider_name, category, username_hint, sign_in_url, mfa_enabled, mfa_method,
               stored_in_password_manager, unique_password_claimed, recovery_configured,
               reported_breached, review_interval_days, last_reviewed_at, notes, created_at, updated_at`,
    [
      userId,
      input.providerName.trim(),
      input.category ?? 'other',
      input.usernameHint?.trim() || null,
      input.signInUrl?.trim() || null,
      input.mfaEnabled ?? false,
      input.mfaMethod ?? 'none',
      input.storedInPasswordManager ?? false,
      input.uniquePasswordClaimed ?? false,
      input.recoveryConfigured ?? false,
      input.reportedBreached ?? false,
      input.reviewIntervalDays ?? 90,
      input.notes?.trim() || null,
    ],
  )
  if (!row) throw new AppError(500, 'internal_error', 'The account could not be added.')

  const account = toAccount(row)
  await recordSecurityEvent({
    userId,
    category: 'account_asset',
    eventType: 'digital_account_added',
    message: `Added ${account.providerName} to the accounts you track.`,
  })
  await refreshAssessment(userId, 'account_created')

  return account
}

/**
 * A PUT with the whole record. Fields the form does not send are cleared rather
 * than guessed at, which is what a form-driven client expects.
 */
export async function updateAccount(userId: string, id: string, input: AccountInput): Promise<DigitalAccount> {
  assertMfaConsistent(input)

  const row = await queryOne<AccountRow>(
    `update digital_accounts set
        provider_name = $3, category = $4, username_hint = $5, sign_in_url = $6,
        mfa_enabled = $7, mfa_method = $8, stored_in_password_manager = $9,
        unique_password_claimed = $10, recovery_configured = $11, reported_breached = $12,
        review_interval_days = $13, notes = $14
      where user_id = $1 and id = $2
      returning id, provider_name, category, username_hint, sign_in_url, mfa_enabled, mfa_method,
                stored_in_password_manager, unique_password_claimed, recovery_configured,
                reported_breached, review_interval_days, last_reviewed_at, notes, created_at, updated_at`,
    [
      userId,
      id,
      input.providerName.trim(),
      input.category ?? 'other',
      input.usernameHint?.trim() || null,
      input.signInUrl?.trim() || null,
      input.mfaEnabled ?? false,
      input.mfaMethod ?? 'none',
      input.storedInPasswordManager ?? false,
      input.uniquePasswordClaimed ?? false,
      input.recoveryConfigured ?? false,
      input.reportedBreached ?? false,
      input.reviewIntervalDays ?? 90,
      input.notes?.trim() || null,
    ],
  )
  if (!row) throw AppError.notFound('That account is not in your list.')

  await recordSecurityEvent({
    userId,
    category: 'account_asset',
    eventType: 'digital_account_updated',
    message: `Updated the tracked security details for ${row.provider_name}.`,
  })
  await refreshAssessment(userId, 'account_updated')
  return toAccount(row)
}

/** "I checked this account today" - the action that resets its review clock. */
export async function logReview(userId: string, id: string): Promise<DigitalAccount> {
  const row = await queryOne<AccountRow>(
    `update digital_accounts set last_reviewed_at = now()
      where user_id = $1 and id = $2
      returning id, provider_name, category, username_hint, sign_in_url, mfa_enabled, mfa_method,
                stored_in_password_manager, unique_password_claimed, recovery_configured,
                reported_breached, review_interval_days, last_reviewed_at, notes, created_at, updated_at`,
    [userId, id],
  )
  if (!row) throw AppError.notFound('That account is not in your list.')

  const account = toAccount(row)
  await recordSecurityEvent({
    userId,
    category: 'account_asset',
    eventType: 'digital_account_reviewed',
    message: `Logged a security review of ${account.providerName}.`,
  })
  await refreshAssessment(userId, 'review_logged')
  return account
}

export async function deleteAccount(userId: string, id: string): Promise<{ deleted: true }> {
  const row = await queryOne<{ provider_name: string }>(
    `delete from digital_accounts where user_id = $1 and id = $2 returning provider_name`,
    [userId, id],
  )
  if (!row) throw AppError.notFound('That account is not in your list.')

  await recordSecurityEvent({
    userId,
    category: 'account_asset',
    eventType: 'digital_account_removed',
    message: `Removed ${row.provider_name} from the accounts you track.`,
  })
  await refreshAssessment(userId, 'account_updated')
  return { deleted: true }
}

function assertMfaConsistent(input: AccountInput): void {
  if (input.mfaEnabled && (input.mfaMethod ?? 'none') === 'none') {
    throw AppError.badRequest('Say how two-step verification works on that account, or switch it off.')
  }
}

export async function accountSummary(userId: string) {
  const row = await queryOne<{
    total: string
    with_mfa: string
    needs_review: string
    breached: string
    no_password_manager: string
  }>(
    `select count(*)::text as total,
            count(*) filter (where mfa_enabled)::text as with_mfa,
            count(*) filter (where last_reviewed_at is null
                              or last_reviewed_at < now() - (review_interval_days || ' days')::interval)::text as needs_review,
            count(*) filter (where reported_breached)::text as breached,
            count(*) filter (where not stored_in_password_manager)::text as no_password_manager
       from digital_accounts
      where user_id = $1`,
    [userId],
  )
  return {
    total: Number(row?.total ?? 0),
    withMfa: Number(row?.with_mfa ?? 0),
    needsReview: Number(row?.needs_review ?? 0),
    reportedBreached: Number(row?.breached ?? 0),
    notInPasswordManager: Number(row?.no_password_manager ?? 0),
  }
}
