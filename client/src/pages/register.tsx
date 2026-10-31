import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LockKeyhole, ShieldCheck } from 'lucide-react'
import { AuthLayout } from '../components/auth-layout'
import { Button } from '../components/ui/button'
import { PasswordField, TextField } from '../components/ui/field'
import { Alert } from '../components/ui/feedback'
import { PasswordRules } from '../components/password-rules'
import { ApiError } from '../lib/api'
import { passwordGuidance } from '../lib/password-guidance'
import { useAuth } from '../state/auth'
import { useToast } from '../state/toast'
import type { RegisterResult } from '../lib/api-types'

const MIN_LENGTH_FALLBACK = 12

export function RegisterPage() {
  const { register, policy } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<RegisterResult | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ displayName?: string; email?: string; password?: string; confirm?: string }>({})
  const [serverRules, setServerRules] = useState<string[]>([])
  const [formError, setFormError] = useState<string | null>(null)

  const minLength = policy?.minPasswordLength ?? MIN_LENGTH_FALLBACK
  const rules = passwordGuidance(password, { email, displayName }, minLength)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return

    const errors: typeof fieldErrors = {}
    if (displayName.trim().length < 2) errors.displayName = 'Tell us what to call you.'
    if (!email.trim()) errors.email = 'Enter an email address that looks real.'
    if (password !== confirm) errors.confirm = 'The two passwords do not match.'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setBusy(true)
    setFormError(null)
    setServerRules([])

    try {
      const result = await register({ email: email.trim(), password, displayName: displayName.trim() })
      setCreated(result)
      push({ tone: 'good', title: 'Account created', description: result.message })
    } catch (error) {
      if (error instanceof ApiError) {
        const mapped: typeof fieldErrors = {}
        for (const issue of error.issues) {
          if (issue.field === 'email' || issue.field === 'displayName' || issue.field === 'password') {
            mapped[issue.field as 'email' | 'displayName' | 'password'] = issue.message
          }
        }
        if (error.code === 'conflict') mapped.email = error.message

        const missing = (error.details as { missingRules?: unknown } | undefined)?.missingRules
        const serverList = Array.isArray(missing) ? missing.filter((item): item is string => typeof item === 'string') : []

        setFieldErrors(mapped)
        setServerRules(serverList)
        if (Object.keys(mapped).length === 0 && serverList.length === 0) setFormError(error.message)
      } else {
        setFormError('Digital Guardian could not be reached. Check your connection and try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <AuthLayout
        title="Your account is ready"
        subtitle={created.verificationRequired ? 'One step left: confirm the email address.' : 'Sign in to see your dashboard.'}
      >
        <div className="space-y-4">
          <Alert tone={created.verificationRequired ? 'watch' : 'good'} title={created.message} Icon={created.verificationRequired ? LockKeyhole : ShieldCheck}>
            {created.verificationRequired ? (
              <p className="text-sm">
                The link expires in 24 hours. In a local development setup, Digital Guardian writes this mail to the server outbox
                instead of sending it, so nothing leaves your machine.
              </p>
            ) : (
              <p className="text-sm">Two-step verification can be switched on from Settings once you are in.</p>
            )}
          </Alert>

          <Button size="lg" fullWidth onClick={() => navigate('/login', { replace: true })}>
            Continue to sign in
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your Digital Guardian account"
      subtitle="An email address, a name to be called by, and a password only you know."
      footer={
        <p>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError ? <Alert tone="danger" title="The account was not created" Icon={ShieldCheck}>{formError}</Alert> : null}

        <TextField
          label="What should we call you?"
          name="displayName"
          autoComplete="name"
          required
          value={displayName}
          error={fieldErrors.displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Ana Reyes"
          hint="Shown on your dashboard and in your alerts. Only you see it."
        />

        <TextField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          error={fieldErrors.email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />

        <div>
          <PasswordField
            label="Password"
            name="new-password"
            autoComplete="new-password"
            required
            value={password}
            error={fieldErrors.password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {password.length > 0 ? <PasswordRules rules={rules} className="mt-3" /> : null}
          {serverRules.length > 0 ? (
            <Alert tone="watch" title="Still missing" Icon={LockKeyhole} className="mt-3">
              <ul className="list-disc space-y-0.5 pl-4 text-sm">
                {serverRules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </div>

        <PasswordField
          label="Confirm password"
          name="confirm-password"
          autoComplete="new-password"
          required
          value={confirm}
          error={fieldErrors.confirm}
          onChange={(event) => setConfirm(event.target.value)}
          hint={confirm.length > 0 && confirm === password ? 'The two match.' : undefined}
        />

        <Button type="submit" size="lg" fullWidth loading={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </Button>

        <p className="text-xs leading-relaxed text-faint">
          Your password is hashed with argon2id before it is stored. Digital Guardian will never ask you for the password of
          another service - not here, not in your account list, not anywhere.
        </p>
      </form>
    </AuthLayout>
  )
}
