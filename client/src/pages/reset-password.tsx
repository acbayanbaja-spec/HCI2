import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { AuthLayout } from '../components/auth-layout'
import { PasswordRules } from '../components/password-rules'
import { Button } from '../components/ui/button'
import { PasswordField } from '../components/ui/field'
import { Alert, ErrorState } from '../components/ui/feedback'
import { ApiError, api } from '../lib/api'
import { passwordGuidance } from '../lib/password-guidance'
import { useAuth } from '../state/auth'

type ResetResult = { reset: boolean; revokedSessions: number; message: string }

export function ResetPasswordPage() {
  const { policy } = useAuth()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<ResetResult | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({})
  const [serverRules, setServerRules] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const rules = passwordGuidance(password, { email: '', displayName: '' }, policy?.minPasswordLength ?? 12)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy || !token) return

    if (password !== confirm) {
      setFieldErrors({ confirm: 'The two passwords do not match.' })
      return
    }
    setFieldErrors({})
    setBusy(true)
    setError(null)
    setServerRules([])

    try {
      const result = await api.post<ResetResult>('/api/auth/reset-password', { token, newPassword: password }, { skipRefresh: true })
      setDone(result)
    } catch (cause) {
      if (cause instanceof ApiError) {
        const missing = (cause.details as { missingRules?: unknown } | undefined)?.missingRules
        const list = Array.isArray(missing) ? missing.filter((item): item is string => typeof item === 'string') : []
        setServerRules(list)
        const issue = cause.issues.find((item) => item.field === 'newPassword')
        if (issue) setFieldErrors({ password: issue.message })
        if (list.length === 0 && !issue) setError(cause.message)
      } else {
        setError('Digital Guardian could not be reached. Check your connection and try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <AuthLayout title="This link is incomplete" subtitle="A reset link has to carry the token from the email you received.">
        <ErrorState
          title="No reset token in this address"
          message="If you copied the link by hand, make sure the whole thing - including ?token=… - was copied."
        />
        <div className="mt-4">
          <Link to="/forgot-password" className="font-semibold text-brand hover:underline">
            Request a new reset link
          </Link>
        </div>
      </AuthLayout>
    )
  }

  if (done) {
    return (
      <AuthLayout title="Password changed" subtitle="You can sign in with the new password now.">
        <div className="space-y-4">
          <Alert tone="good" title={done.message} Icon={ShieldCheck}>
            <p className="text-sm">
              {done.revokedSessions > 0
                ? `${done.revokedSessions} signed-in session(s) were ended. That is the intended protection: an old device cannot keep working with the old password.`
                : 'No other sessions were active.'}
            </p>
          </Alert>
          <Link to="/login" className="block">
            <Button size="lg" fullWidth type="button">
              Go to sign in
            </Button>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="This link works once. Changing the password signs every device out of Digital Guardian."
      footer={
        <p>
          Changed your mind?{' '}
          <Link to="/login" className="font-semibold text-brand hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error ? <Alert tone="danger" title="The password was not changed" Icon={ShieldCheck}>{error}</Alert> : null}

        <PasswordField
          label="New password"
          name="new-password"
          autoComplete="new-password"
          required
          value={password}
          error={fieldErrors.password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {password.length > 0 ? <PasswordRules rules={rules} className="-mt-2" /> : null}

        {serverRules.length > 0 ? (
          <Alert tone="watch" title="Still missing" Icon={KeyRound}>
            <ul className="list-disc space-y-0.5 pl-4 text-sm">
              {serverRules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <PasswordField
          label="Confirm new password"
          name="confirm-password"
          autoComplete="new-password"
          required
          value={confirm}
          error={fieldErrors.confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />

        <Button type="submit" size="lg" fullWidth loading={busy}>
          {busy ? 'Changing your password…' : 'Change password'}
        </Button>
      </form>
    </AuthLayout>
  )
}
