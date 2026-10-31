import { useState, type FormEvent } from 'react'
import { KeyRound, LogOut, Monitor, RefreshCw, ShieldCheck, ShieldOff, Smartphone, Tablet } from 'lucide-react'
import { Card, CardBody, CardFooter, CardHeader, PageHeader } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, Badge, EmptyState, ErrorState, SkeletonList } from '../components/ui/feedback'
import { PasswordField, TextField } from '../components/ui/field'
import { ConfirmDialog, Dialog, DialogFooter } from '../components/ui/dialog'
import { PasswordRules } from '../components/password-rules'
import { api, ApiError } from '../lib/api'
import type { MfaSetup, Profile, SessionInfo } from '../lib/api-types'
import { formatDateTime, formatRelative, plural } from '../lib/format'
import { passwordGuidance } from '../lib/password-guidance'
import { useResource } from '../lib/use-resource'
import { useAuth } from '../state/auth'
import { useToast } from '../state/toast'

function platformIcon(platform: string | null) {
  if (platform === 'mobile') return Smartphone
  if (platform === 'tablet') return Tablet
  return Monitor
}

export function SecuritySettingsPage() {
  const { push } = useToast()
  const { user, policy, logout } = useAuth()

  const profile = useResource<Profile>((signal) => api.get('/api/settings/profile', { signal }), [])
  const sessions = useResource<{ sessions: SessionInfo[]; note: string }>((signal) => api.get('/api/settings/sessions', { signal }), [])

  /* --- password --- */
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<{ currentPassword?: string; newPassword?: string; confirm?: string }>({})
  const [missingRules, setMissingRules] = useState<string[]>([])
  const [changing, setChanging] = useState(false)

  /* --- mfa --- */
  const [setup, setSetup] = useState<MfaSetup | null>(null)
  const [setupBusy, setSetupBusy] = useState(false)
  const [enrollCode, setEnrollCode] = useState('')
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [disableOpen, setDisableOpen] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [disableBusy, setDisableBusy] = useState(false)
  const [rotateBusy, setRotateBusy] = useState(false)

  /* --- sessions --- */
  const [revokeTarget, setRevokeTarget] = useState<SessionInfo | null>(null)
  const [revokeAllOpen, setRevokeAllOpen] = useState(false)
  const [sessionBusy, setSessionBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const minLength = policy?.minPasswordLength ?? 12
  const rules = passwordGuidance(next, { email: profile.data?.email ?? user?.email, displayName: profile.data?.displayName ?? user?.displayName }, minLength)

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    const errors: typeof passwordErrors = {}
    if (!current) errors.currentPassword = 'Enter your current password.'
    if (next.length < minLength) errors.newPassword = `Use at least ${minLength} characters.`
    if (next !== confirm) errors.confirm = 'The two passwords do not match.'
    setPasswordErrors(errors)
    setMissingRules([])
    if (Object.keys(errors).length > 0 || !next || !current) return

    setChanging(true)
    try {
      const result = await api.put<{ revokedSessions: number; message: string }>('/api/settings/password', {
        currentPassword: current,
        newPassword: next,
      })
      setCurrent('')
      setNext('')
      setConfirm('')
      sessions.reload()
      push({ tone: 'good', title: 'Password changed', description: result.message })
    } catch (error) {
      if (error instanceof ApiError) {
        const serverRules = (error.details as { missingRules?: string[] } | undefined)?.missingRules
        if (serverRules?.length) setMissingRules(serverRules)
        push({ tone: 'danger', title: 'Password not changed', description: error.message })
        if (error.status === 401) setCurrent('')
      } else {
        push({ tone: 'danger', title: 'Password not changed', description: error instanceof Error ? error.message : 'Try again.' })
      }
    } finally {
      setChanging(false)
    }
  }

  async function startSetup() {
    if (setupBusy) return
    setSetupBusy(true)
    setEnrollError(null)
    try {
      setSetup(await api.post<MfaSetup>('/api/settings/mfa/setup'))
      setEnrollCode('')
    } catch (error) {
      push({ tone: 'danger', title: 'Setup could not start', description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setSetupBusy(false)
    }
  }

  async function finishSetup(event: FormEvent) {
    event.preventDefault()
    if (setupBusy || !/^\d{6}$/.test(enrollCode)) {
      setEnrollError('Enter the six digits shown by your app.')
      return
    }
    setSetupBusy(true)
    setEnrollError(null)
    try {
      const result = await api.post<{ enabled: boolean; recoveryCodes: string[]; message: string }>('/api/settings/mfa/enable', { code: enrollCode })
      setSetup(null)
      setRecoveryCodes(result.recoveryCodes)
      profile.reload()
      sessions.reload()
      push({ tone: 'good', title: 'Two-step verification is on', description: 'Every other device was asked to sign in again.' })
    } catch (error) {
      setEnrollError(error instanceof Error ? error.message : 'That code did not work.')
    } finally {
      setSetupBusy(false)
    }
  }

  async function rotateCodes() {
    if (rotateBusy) return
    setRotateBusy(true)
    try {
      const result = await api.post<{ recoveryCodes: string[]; message: string }>('/api/settings/mfa/recovery-codes')
      setRecoveryCodes(result.recoveryCodes)
      push({ tone: 'info', title: 'New recovery codes created', description: 'The previous set no longer works.' })
    } catch (error) {
      push({ tone: 'danger', title: 'Codes were not replaced', description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setRotateBusy(false)
    }
  }

  async function disableMfa() {
    if (disableBusy) return
    setDisableBusy(true)
    try {
      const result = await api.post<{ enabled: boolean; message: string }>('/api/settings/mfa/disable', {
        password: disablePassword,
        code: disableCode,
      })
      setDisableOpen(false)
      setDisablePassword('')
      setDisableCode('')
      profile.reload()
      // The server ends every session, including this one, so say so before the redirect.
      push({ tone: 'warn', title: 'Two-step verification is off', description: `${result.message} You will be returned to sign-in.` })
      await logout()
    } catch (error) {
      push({ tone: 'danger', title: 'Two-step verification stayed on', description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setDisableBusy(false)
    }
  }

  async function revokeOne(session: SessionInfo) {
    if (sessionBusy) return
    setSessionBusy(true)
    try {
      await api.del(`/api/settings/sessions/${session.id}`)
      setRevokeTarget(null)
      sessions.reload()
      push({ tone: 'good', title: 'That device was signed out' })
    } catch (error) {
      push({ tone: 'danger', title: 'The device stayed signed in', description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setSessionBusy(false)
    }
  }

  async function revokeOthers() {
    if (sessionBusy) return
    setSessionBusy(true)
    try {
      const result = await api.post<{ revokedSessions: number; message: string }>('/api/settings/sessions/revoke-others')
      setRevokeAllOpen(false)
      sessions.reload()
      profile.reload()
      push({ tone: 'good', title: result.message, description: 'Only this device is still signed in.' })
    } catch (error) {
      push({ tone: 'danger', title: 'Other devices stayed signed in', description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setSessionBusy(false)
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      push({ tone: 'info', title: `${label} copied` })
    } catch {
      push({ tone: 'warn', title: 'Copy blocked by your browser', description: 'Select the text and copy it manually.' })
    }
  }

  const mfaEnabled = profile.data?.mfaEnabled ?? user?.mfaEnabled ?? false
  const list = sessions.data?.sessions ?? []

  return (
    <>
      <PageHeader title="Security & devices" description="Your password, two-step verification, and every device that is signed in." />

      <div className="mt-5 space-y-5">
        <Card>
          <CardHeader
            title="Two-step verification"
            description={mfaEnabled ? 'On. Your authenticator app is required for every new sign-in.' : 'Off. Your password alone protects this account.'}
            icon={mfaEnabled ? <ShieldCheck className="size-4" /> : <ShieldOff className="size-4" />}
            action={<Badge tone={mfaEnabled ? 'good' : 'warn'}>{mfaEnabled ? 'Switched on' : 'Switched off'}</Badge>}
          />
          {profile.error ? (
            <CardBody>
              <ErrorState title="Your security settings did not load" message={profile.error.message} onRetry={profile.reload} />
            </CardBody>
          ) : profile.loading ? (
            <CardBody>
              <SkeletonList rows={2} />
            </CardBody>
          ) : mfaEnabled ? (
            <>
              <CardBody className="space-y-3 text-sm text-muted">
                <p>
                  Recovery codes work when your phone does not. Each one can be used once. If you think a code leaked, replace the
                  whole set — the old ones stop working immediately.
                </p>
                {recoveryCodes ? (
                  <div className="rounded-[var(--radius-field)] border border-line-strong bg-sunken p-3.5">
                    <p className="text-xs font-semibold text-ink">
                      These are shown once. Save them somewhere offline, then this panel can be closed.
                    </p>
                    <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      {recoveryCodes.map((code, index) => (
                        <li key={code} className="flex items-center gap-2">
                          <span className="text-xs text-faint tabular-nums">{index + 1}.</span>
                          <code className="font-mono text-sm text-ink">{code}</code>
                        </li>
                      ))}
                    </ul>
                    <Button className="mt-3" size="sm" variant="secondary" onClick={() => copy(recoveryCodes.join('\n'), 'Recovery codes')}>
                      Copy all ten
                    </Button>
                  </div>
                ) : null}
              </CardBody>
              <CardFooter className="flex flex-wrap gap-2">
                <Button variant="secondary" loading={rotateBusy} onClick={rotateCodes}>
                  <RefreshCw className="size-4" aria-hidden="true" /> Replace recovery codes
                </Button>
                <Button variant="ghost" onClick={() => setDisableOpen(true)}>
                  <ShieldOff className="size-4" aria-hidden="true" /> Switch off two-step verification
                </Button>
              </CardFooter>
            </>
          ) : (
            <CardBody className="space-y-3">
              {!profile.data ? null : (
                <>
                  <Alert tone="warn" Icon={KeyRound} title="This is the single biggest change you can make">
                    <p className="text-sm">
                      Two-step verification stops almost every password-only attack: the stolen password is no longer enough. It is
                      worth real points on your score, and setup takes about a minute with any authenticator app.
                    </p>
                  </Alert>
                  <Button loading={setupBusy} onClick={startSetup}>
                    <ShieldCheck className="size-4" aria-hidden="true" /> Set up two-step verification
                  </Button>
                </>
              )}
            </CardBody>
          )}
        </Card>

        <form onSubmit={changePassword} noValidate>
          <Card>
            <CardHeader title="Sign-in password" description={`At least ${minLength} characters. Hashed with argon2id — never stored or shown in plain text.`} />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <PasswordField
                label="Current password"
                required
                autoComplete="current-password"
                value={current}
                error={passwordErrors.currentPassword}
                onChange={(event) => setCurrent(event.target.value)}
              />
              <div className="hidden sm:block" />
              <PasswordField
                label="New password"
                required
                autoComplete="new-password"
                value={next}
                error={passwordErrors.newPassword}
                hint="Do not reuse a password from anywhere else."
                onChange={(event) => setNext(event.target.value)}
                containerClassName="sm:col-span-2"
              />
              {missingRules.length > 0 ? (
                <div className="sm:col-span-2">
                  <Alert tone="danger" title="The server checked your new password and asked for more">
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {missingRules.map((rule) => (
                        <li key={rule}>{rule}</li>
                      ))}
                    </ul>
                  </Alert>
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <PasswordRules rules={rules} />
                </div>
              )}
              <PasswordField
                label="Repeat new password"
                required
                autoComplete="new-password"
                value={confirm}
                error={passwordErrors.confirm}
                onChange={(event) => setConfirm(event.target.value)}
                containerClassName="sm:col-span-2"
              />
            </CardBody>
            <CardFooter className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-faint">
                Changing it signs out your other devices, and {policy?.maxFailedLogins ?? 5} failed attempts lock the account for{' '}
                {policy?.accountLockMinutes ?? 15} minutes.
              </p>
              <Button type="submit" loading={changing} disabled={!current || !next || !confirm}>
                <KeyRound className="size-4" aria-hidden="true" /> Change password
              </Button>
            </CardFooter>
          </Card>
        </form>

        <Card>
          <CardHeader
            title="Devices and sessions"
            description={sessions.data?.note ?? 'Every active sign-in for this account.'}
            icon={<Monitor className="size-4" />}
            action={
              <Button size="sm" variant="danger" onClick={() => setRevokeAllOpen(true)} disabled={list.length <= 1}>
                <LogOut className="size-4" aria-hidden="true" /> Sign out other devices
              </Button>
            }
          />
          <CardBody className="p-0">
            {sessions.loading ? (
              <div className="px-4 sm:px-5">
                <SkeletonList rows={2} />
              </div>
            ) : sessions.error ? (
              <div className="px-4 sm:px-5">
                <ErrorState title="Your devices did not load" message={sessions.error.message} onRetry={sessions.reload} />
              </div>
            ) : list.length === 0 ? (
              <div className="px-4 sm:px-5">
                <EmptyState icon={<Monitor className="size-6" />} title="No active sessions" description="This screen should have shown at least the device you are using now." />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((session) => {
                  const Icon = platformIcon(session.platform)
                  return (
                    <li key={session.id} className="px-4 py-4 sm:px-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                            <p className="text-sm font-semibold text-ink">{session.deviceLabel}</p>
                            {session.isCurrent ? <Badge tone="good">This device</Badge> : null}
                            {session.signedInWithMfa ? <Badge tone="neutral">Signed in with two-step</Badge> : <Badge tone="watch">Password only</Badge>}
                          </div>
                          <p className="mt-1 text-sm text-muted">
                            {[session.browser, session.os].filter(Boolean).join(' · ') || 'Browser not reported'}
                          </p>
                          <p className="mt-1 text-xs text-faint">
                            Signed in {formatRelative(session.createdAt)} · last seen{' '}
                            <span title={formatDateTime(session.lastSeenAt)}>{formatRelative(session.lastSeenAt)}</span> · expires{' '}
                            {formatDateTime(session.expiresAt)}
                          </p>
                        </div>
                        {!session.isCurrent ? (
                          <Button size="sm" variant="ghost" onClick={() => setRevokeTarget(session)}>
                            Sign out this device
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Alert tone="info" Icon={ShieldCheck} title="What is recorded, and what is not">
          <p className="text-sm">
            A session stores the browser and operating system your own device reported in its user-agent string, the time it signed
            in, and when it was last seen. Digital Guardian does not track a precise location, does not record which pages you look
            at, and deletes a session record once it expires. {plural(list.length, 'session')} {list.length === 1 ? 'is' : 'are'}{' '}
            currently active.
          </p>
        </Alert>

        <Card as="div">
          <CardHeader title="Last resort" description="Use these when you cannot trust a session or your password any more." />
          <CardBody className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={signingOut} onClick={async () => { setSigningOut(true); try { await logout() } finally { setSigningOut(false) } }}>
              <LogOut className="size-4" aria-hidden="true" /> Sign out of this device
            </Button>
            <Button variant="danger" loading={sessionBusy} onClick={() => setRevokeAllOpen(true)} disabled={list.length <= 1}>
              Sign out everywhere but here
            </Button>
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={setup !== null}
        onClose={() => setSetup(null)}
        title="Add Digital Guardian to your authenticator app"
        description="The secret below is shown once, right now. Confirming a code from the app is what switches two-step verification on."
        footer={
          <DialogFooter
            cancel={() => setSetup(null)}
            confirm={
              <form onSubmit={finishSetup} className="flex w-full flex-wrap items-center gap-2">
                <TextField
                  label="Six-digit code"
                  value={enrollCode}
                  error={enrollError ?? undefined}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="w-40"
                  onChange={(event) => setEnrollCode(event.target.value.replace(/\D/g, ''))}
                />
                <Button type="submit" loading={setupBusy} className="mt-0">
                  Confirm and switch on
                </Button>
              </form>
            }
          />
        }
      >
        {setup ? (
          <div className="space-y-4">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
              {setup.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>

            <div className="rounded-[var(--radius-field)] border border-line-strong bg-sunken p-3.5">
              <p className="text-xs font-semibold text-ink">Manual setup code</p>
              <p className="mt-1 break-all font-mono text-sm text-ink">{setup.manualCode}</p>
              <p className="mt-2 text-xs text-faint">
                Account: {setup.accountLabel} · Issuer: {setup.issuer}
              </p>
              <Button className="mt-3" size="sm" variant="secondary" onClick={() => copy(setup.manualCode, 'Setup code')}>
                Copy manual code
              </Button>
            </div>

            <div className="rounded-[var(--radius-field)] border border-line bg-sunken/60 p-3.5">
              <p className="text-xs font-semibold text-ink">Setup link</p>
              <p className="mt-1 break-all font-mono text-xs text-muted">{setup.otpauthUri}</p>
              <p className="mt-2 text-xs text-faint">
                Your authenticator app opens this itself. It is plain text here so nothing is fetched or launched by Digital
                Guardian.
              </p>
            </div>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={disableOpen}
        title="Switch off two-step verification?"
        description="Your account goes back to password-only protection, every device is signed out, and your recovery codes are destroyed."
        confirmLabel="Yes, switch it off"
        busy={disableBusy}
        onConfirm={disableMfa}
        onCancel={() => setDisableOpen(false)}
      >
        <div className="space-y-4">
          <PasswordField
            label="Your password"
            value={disablePassword}
            autoComplete="current-password"
            onChange={(event) => setDisablePassword(event.target.value)}
          />
          <TextField
            label="Current six-digit code, or an unused recovery code"
            value={disableCode}
            autoComplete="one-time-code"
            maxLength={20}
            onChange={(event) => setDisableCode(event.target.value)}
          />
          <p className="text-xs text-faint">This proves the request came from someone who can unlock the second factor, not just someone who knows the password.</p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Sign this device out?"
        description={revokeTarget ? `“${revokeTarget.deviceLabel}” will have to sign in again, including two-step verification.` : ''}
        confirmLabel="Sign it out"
        busy={sessionBusy}
        onConfirm={() => revokeTarget && revokeOne(revokeTarget)}
        onCancel={() => setRevokeTarget(null)}
      />

      <ConfirmDialog
        open={revokeAllOpen}
        title="Sign out every other device?"
        description={`This ends ${Math.max(list.length - 1, 0)} other ${plural(Math.max(list.length - 1, 0), 'session')}. Anything actually signed in elsewhere has to authenticate again — which is exactly what you want if a device is not yours.`}
        confirmLabel="Sign out the others"
        busy={sessionBusy}
        tone="primary"
        onConfirm={revokeOthers}
        onCancel={() => setRevokeAllOpen(false)}
      />
    </>
  )
}
