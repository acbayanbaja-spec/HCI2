import { AppError } from '../lib/errors'
import { query, queryOne } from '../db/pool'
import { recordSecurityEvent } from './audit.service'

export type NotificationPreferences = {
  securityAlerts: boolean
  recommendationDigests: boolean
  reportUpdates: boolean
  learningNudges: boolean
  emergencyReminders: boolean
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  securityAlerts: true,
  recommendationDigests: true,
  reportUpdates: true,
  learningNudges: true,
  emergencyReminders: true,
}

export type ProfileView = {
  displayName: string
  email: string
  role: 'user' | 'admin'
  emailVerified: boolean
  mfaEnabled: boolean
  createdAt: Date
  lastLoginAt: Date | null
  fullName: string | null
  preferredName: string | null
  phone: string | null
  recoveryEmail: string | null
  timezone: string
  locale: string
  theme: 'system' | 'light' | 'dark'
  notifications: NotificationPreferences
  /**
   * Honest statement of what the platform can and cannot see. Digital Guardian
   * never reads an outside service, so nothing here is auto-detected.
   */
  privacyNote: string
}

const PRIVACY_NOTE =
  'Digital Guardian keeps what you tell it about your other accounts. It does not sign in to them, read them, or collect data from them.'

function toBooleanMap(raw: unknown): NotificationPreferences {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    securityAlerts: source.securityAlerts !== false,
    recommendationDigests: source.recommendationDigests !== false,
    reportUpdates: source.reportUpdates !== false,
    learningNudges: source.learningNudges !== false,
    emergencyReminders: source.emergencyReminders !== false,
  }
}

export async function getProfile(userId: string): Promise<ProfileView> {
  const row = await queryOne<Record<string, unknown>>(
    `select u.display_name as "displayName", u.email, u.role_key as role,
            (u.email_verified_at is not null) as "emailVerified", u.mfa_enabled as "mfaEnabled",
            u.created_at as "createdAt", u.last_login_at as "lastLoginAt",
            p.full_name as "fullName", p.preferred_name as "preferredName", p.phone_e164 as phone,
            p.recovery_email as "recoveryEmail", p.timezone, p.locale,
            coalesce(pref.theme, 'system') as theme,
            coalesce(pref.notifications, '{}'::jsonb) as notifications
       from users u
       left join user_profiles p on p.user_id = u.id
       left join user_preferences pref on pref.user_id = u.id
      where u.id = $1 and u.deleted_at is null`,
    [userId],
  )
  if (!row) throw AppError.notFound()

  return {
    displayName: String(row.displayName),
    email: String(row.email),
    role: row.role as 'user' | 'admin',
    emailVerified: Boolean(row.emailVerified),
    mfaEnabled: Boolean(row.mfaEnabled),
    createdAt: new Date(String(row.createdAt)),
    lastLoginAt: row.lastLoginAt ? new Date(String(row.lastLoginAt)) : null,
    fullName: row.fullName ? String(row.fullName) : null,
    preferredName: row.preferredName ? String(row.preferredName) : null,
    phone: row.phone ? String(row.phone) : null,
    recoveryEmail: row.recoveryEmail ? String(row.recoveryEmail) : null,
    timezone: String(row.timezone ?? 'Asia/Manila'),
    locale: String(row.locale ?? 'en-PH'),
    theme: row.theme as ProfileView['theme'],
    notifications: toBooleanMap(row.notifications),
    privacyNote: PRIVACY_NOTE,
  }
}

export async function updateProfile(
  userId: string,
  input: { displayName: string; fullName?: string | null; preferredName?: string | null; phone?: string | null; recoveryEmail?: string | null; timezone: string; locale: string },
): Promise<ProfileView> {
  await query(
    `update users set display_name = $2 where id = $1 and deleted_at is null`,
    [userId, input.displayName.trim()],
  )
  await query(
    `insert into user_profiles (user_id, full_name, preferred_name, phone_e164, recovery_email, timezone, locale)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id) do update
       set full_name = excluded.full_name,
           preferred_name = excluded.preferred_name,
           phone_e164 = excluded.phone_e164,
           recovery_email = excluded.recovery_email,
           timezone = excluded.timezone,
           locale = excluded.locale`,
    [
      userId,
      input.fullName?.trim() || null,
      input.preferredName?.trim() || null,
      input.phone?.trim() || null,
      input.recoveryEmail?.trim().toLowerCase() || null,
      input.timezone,
      input.locale,
    ],
  )

  // A recovery address is a scoring input, so the caller refreshes the score.
  await recordSecurityEvent({
    userId,
    category: 'profile',
    eventType: 'profile_updated',
    message: 'Profile details were updated.',
  })

  return getProfile(userId)
}

export async function updatePreferences(
  userId: string,
  input: { theme?: 'system' | 'light' | 'dark'; notifications?: Partial<NotificationPreferences> },
): Promise<Pick<ProfileView, 'theme' | 'notifications'>> {
  const current = await queryOne<{ theme: string; notifications: unknown }>(
    'select theme, notifications from user_preferences where user_id = $1',
    [userId],
  )
  const merged = toBooleanMap({ ...toBooleanMap(current?.notifications), ...(input.notifications ?? {}) })

  await query(
    // $2 is cast because coalesce(?, 'system') has no way to infer a type.
    `insert into user_preferences (user_id, theme, notifications)
     values ($1, coalesce($2::text, 'system'), $3::jsonb)
     on conflict (user_id) do update
       set theme = coalesce($2::text, user_preferences.theme),
           notifications = excluded.notifications`,
    [userId, input.theme ?? null, JSON.stringify(merged)],
  )

  return { theme: (input.theme ?? (current?.theme as ProfileView['theme']) ?? 'system') as ProfileView['theme'], notifications: merged }
}
