import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Check, Info, Mail, Moon, Monitor, Palette, Save, Sun } from 'lucide-react'
import { Card, CardBody, CardFooter, CardHeader, PageHeader } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, Badge, ErrorState, SkeletonList } from '../components/ui/feedback'
import { SelectField, TextField } from '../components/ui/field'
import { api, ApiError } from '../lib/api'
import type { Profile, ThemePreference } from '../lib/api-types'
import { formatDateTime } from '../lib/format'
import { useResource } from '../lib/use-resource'
import { useAuth } from '../state/auth'
import { useTheme } from '../state/theme'
import { useToast } from '../state/toast'

const TIMEZONES = [
  { value: 'Asia/Manila', label: 'Philippines (Asia/Manila)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Tokyo', label: 'Japan (Asia/Tokyo)' },
  { value: 'Australia/Sydney', label: 'Australia, Sydney' },
  { value: 'Europe/London', label: 'United Kingdom (London)' },
  { value: 'Europe/Berlin', label: 'Germany (Berlin)' },
  { value: 'America/New_York', label: 'United States, New York' },
  { value: 'America/Los_Angeles', label: 'United States, Los Angeles' },
  { value: 'UTC', label: 'Coordinated Universal Time' },
]

const LOCALES = [
  { value: 'en-PH', label: 'English (Philippines)' },
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'fil-PH', label: 'Filipino (Philippines)' },
]

const THEME_CARDS: Array<{ value: ThemePreference; label: string; description: string; Icon: typeof Monitor }> = [
  { value: 'system', label: 'Follow my device', description: 'Matches your operating system setting.', Icon: Monitor },
  { value: 'light', label: 'Light', description: 'Bright surfaces, dark text.', Icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Low-glare surfaces for night use.', Icon: Moon },
]

type Draft = {
  displayName: string
  fullName: string
  preferredName: string
  phone: string
  recoveryEmail: string
  timezone: string
  locale: string
}

function toDraft(profile: Profile): Draft {
  return {
    displayName: profile.displayName,
    fullName: profile.fullName ?? '',
    preferredName: profile.preferredName ?? '',
    phone: profile.phone ?? '',
    recoveryEmail: profile.recoveryEmail ?? '',
    timezone: profile.timezone,
    locale: profile.locale,
  }
}

export function ProfileSettingsPage() {
  const { push } = useToast()
  const { applyUser, user, policy } = useAuth()
  const { preference, setPreference } = useTheme()

  const resource = useResource<Profile>((signal) => api.get('/api/settings/profile', { signal }), [])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [themeBusy, setThemeBusy] = useState(false)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    if (resource.data && !draft) setDraft(toDraft(resource.data))
  }, [resource.data, draft])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || saving) return

    const found: Record<string, string> = {}
    if (draft.displayName.trim().length < 2) found.displayName = 'Tell us what to call you.'
    if (draft.recoveryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.recoveryEmail.trim())) {
      found.recoveryEmail = 'That recovery email does not look valid.'
    }
    if (draft.phone && !/^\+?[0-9\s-]{6,20}$/.test(draft.phone.trim())) found.phone = 'That phone number does not look usable.'
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSaving(true)
    try {
      const result = await api.put<{ profile: Profile; score: { score: number } }>('/api/settings/profile', {
        displayName: draft.displayName.trim(),
        fullName: draft.fullName.trim() || null,
        preferredName: draft.preferredName.trim() || null,
        phone: draft.phone.trim() || null,
        recoveryEmail: draft.recoveryEmail.trim() || null,
        timezone: draft.timezone,
        locale: draft.locale,
      })
      resource.replace(result.profile)
      setDraft(toDraft(result.profile))
      if (user) applyUser({ ...user, displayName: result.profile.displayName })
      push({ tone: 'good', title: 'Profile saved', description: `Your score was recalculated: ${result.score.score}/100.` })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'validation_failed') {
        setErrors(Object.fromEntries(error.issues.map((issue) => [issue.field, issue.message])))
        push({ tone: 'danger', title: 'Some answers need fixing' })
      } else {
        push({ tone: 'danger', title: 'Your profile was not saved', description: error instanceof Error ? error.message : 'Try again.' })
      }
    } finally {
      setSaving(false)
    }
  }

  async function chooseTheme(next: ThemePreference) {
    if (themeBusy || next === preference) return
    setThemeBusy(true)
    const previous = preference
    setPreference(next)
    try {
      await api.put<{ theme: ThemePreference }>('/api/settings/preferences', { theme: next })
      resource.reload()
    } catch (error) {
      setPreference(previous)
      push({ tone: 'danger', title: 'Theme was not saved', description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setThemeBusy(false)
    }
  }

  async function resendVerification() {
    if (verifying) return
    setVerifying(true)
    try {
      const result = await api.post<{ message: string }>('/api/auth/resend-verification')
      push({
        tone: 'info',
        title: 'Verification link sent',
        description: policy?.mailDelivery === 'outbox' ? 'In this environment the message is written to the server outbox folder.' : result.message,
      })
    } catch (error) {
      push({ tone: 'danger', title: 'Could not send the link', description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setVerifying(false)
    }
  }

  const profile = resource.data

  return (
    <>
      <PageHeader title="Profile" description="How you are addressed, how you get back in, and how the interface looks." />

      {resource.error ? (
        <div className="mt-5">
          <ErrorState title="Your profile did not load" message={resource.error.message} onRetry={resource.reload} />
        </div>
      ) : resource.loading || !profile || !draft ? (
        <div className="mt-5 space-y-4">
          <SkeletonList rows={4} />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {!profile.emailVerified ? (
            <Alert
              tone="warn"
              Icon={Mail}
              title="Confirm your email address"
              action={
                <Button size="sm" variant="secondary" loading={verifying} onClick={resendVerification}>
                  Send the link again
                </Button>
              }
            >
              <p className="text-sm">
                We sent a link to <strong className="font-semibold text-ink">{profile.email}</strong>. Until it is used, password
                resets and recovery have nowhere trusted to go.
              </p>
            </Alert>
          ) : (
            <Alert tone="good" Icon={Check} title="Your sign-in email is confirmed">
              <p className="text-sm">
                {profile.email}
                {profile.recoveryEmail ? (
                  <>
                    {' '}
                    with <strong className="font-semibold text-ink">{profile.recoveryEmail}</strong> as a backup address.
                  </>
                ) : (
                  '.'
                )}
              </p>
            </Alert>
          )}

          <form onSubmit={save} noValidate>
            <Card>
              <CardHeader title="How you are known" description="Only your name and contact details. Your password is never stored in a readable form." />
              <CardBody className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Display name"
                  required
                  value={draft.displayName}
                  error={errors.displayName}
                  maxLength={80}
                  autoComplete="name"
                  onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                />
                <TextField
                  label="Email for signing in"
                  value={profile.email}
                  readOnly
                  hint="Changing your sign-in address is handled by support so the new address can be verified first."
                  onChange={() => {}}
                />
                <TextField
                  label="Full name"
                  value={draft.fullName}
                  maxLength={120}
                  hint="Optional. Used only if you want a formal name on records."
                  onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}
                />
                <TextField
                  label="Preferred name"
                  value={draft.preferredName}
                  maxLength={60}
                  hint="Optional. What you would rather be called day to day."
                  onChange={(event) => setDraft({ ...draft, preferredName: event.target.value })}
                />
                <TextField
                  label="Phone"
                  value={draft.phone}
                  error={errors.phone}
                  maxLength={20}
                  inputMode="tel"
                  placeholder="+63 900 000 0000"
                  hint="Optional. Never used to contact you unless you ask for it."
                  onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                />
                <TextField
                  label="Recovery email"
                  value={draft.recoveryEmail}
                  error={errors.recoveryEmail}
                  type="email"
                  maxLength={254}
                  autoComplete="email"
                  hint="A second address you control. This one counts towards your score."
                  onChange={(event) => setDraft({ ...draft, recoveryEmail: event.target.value })}
                />
                <SelectField
                  label="Time zone"
                  value={draft.timezone}
                  options={draft.timezone && !TIMEZONES.some((entry) => entry.value === draft.timezone)
                    ? [...TIMEZONES, { value: draft.timezone, label: draft.timezone }]
                    : TIMEZONES}
                  hint="Used to date your activity the way you read it."
                  onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
                />
                <SelectField
                  label="Language"
                  value={draft.locale}
                  options={draft.locale && !LOCALES.some((entry) => entry.value === draft.locale)
                    ? [...LOCALES, { value: draft.locale, label: draft.locale }]
                    : LOCALES}
                  onChange={(event) => setDraft({ ...draft, locale: event.target.value })}
                />
              </CardBody>
              <CardFooter className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-faint">Saved changes are recorded in your security activity log.</p>
                <Button type="submit" loading={saving}>
                  <Save className="size-4" aria-hidden="true" /> Save profile
                </Button>
              </CardFooter>
            </Card>
          </form>

          <Card>
            <CardHeader title="Appearance" description="Saved to your account, so any device you sign in from looks the same." icon={<Palette className="size-4" />} />
            <CardBody className="grid gap-3 sm:grid-cols-3">
              {THEME_CARDS.map(({ value, label, description, Icon }) => {
                const selected = preference === value
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={themeBusy}
                    onClick={() => chooseTheme(value)}
                    aria-pressed={selected}
                    className={
                      selected
                        ? 'flex h-full items-start gap-3 rounded-[var(--radius-field)] border-2 border-brand bg-brand-soft px-3.5 py-3 text-left'
                        : 'flex h-full items-start gap-3 rounded-[var(--radius-field)] border border-line-strong bg-surface px-3.5 py-3 text-left hover:bg-sunken'
                    }
                  >
                    <Icon className={selected ? 'mt-0.5 size-4 shrink-0 text-brand' : 'mt-0.5 size-4 shrink-0 text-muted'} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{label}</span>
                      <span className="mt-0.5 block text-xs text-muted">{description}</span>
                    </span>
                  </button>
                )
              })}
            </CardBody>
          </Card>

          <Card as="div">
            <CardHeader title="What this account holds" description="Facts about your own account, nothing else." />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">Role</span>
                <Badge tone={profile.role === 'admin' ? 'watch' : 'neutral'}>{profile.role === 'admin' ? 'Administrator' : 'Member'}</Badge>
              </div>
              <div className="text-sm">
                <span className="text-muted">Two-step verification </span>
                <span className="font-semibold text-ink">{profile.mfaEnabled ? 'on' : 'off'}</span>
                <Link to="/settings/security" className="ml-2 font-semibold text-brand hover:underline">
                  {profile.mfaEnabled ? 'Manage' : 'Turn it on'}
                </Link>
              </div>
              <p className="text-sm text-muted">
                <span>Created </span>
                <span className="font-medium text-ink">{formatDateTime(profile.createdAt)}</span>
              </p>
              <p className="text-sm text-muted">
                <span>Last sign-in </span>
                <span className="font-medium text-ink">{profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : 'this session'}</span>
              </p>
            </CardBody>
          </Card>

          <Alert tone="info" Icon={Info} title="What Digital Guardian can and cannot see">
            <p className="text-sm">{profile.privacyNote}</p>
          </Alert>
        </div>
      )}
    </>
  )
}
