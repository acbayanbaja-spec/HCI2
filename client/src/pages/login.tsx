import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Gauge, LockKeyhole, ScanSearch, ShieldCheck } from 'lucide-react'
import { AuthLayout, AuthPoint } from '../components/auth-layout'
import { Button } from '../components/ui/button'
import { PasswordField, TextField } from '../components/ui/field'
import { Alert } from '../components/ui/feedback'
import { ApiError } from '../lib/api'
import { plural } from '../lib/format'
import { useAuth } from '../state/auth'
import { useToast } from '../state/toast'
import type { LoginSuccess } from '../lib/api-types'

type Step = 'credentials' | 'two_factor'

type LocationState = { notice?: string; from?: string } | null

function lockoutMessage(error: ApiError): string {
  const details = error.details as { lockedUntil?: string } | undefined
  const until = details?.lockedUntil
  const minutes = until && !Number.isNaN(new Date(until).getTime())
    ? Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60_000))
    : null
  return `Too many failed attempts. Sign-in is paused for about ${minutes ? plural(minutes, 'minute') : 'a few minutes'}.`
}

export function LoginPage() {
  const { login, submitMfa, policy, clearSessionNotice } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState

  const [step, setStep] = useState<Step>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [friendlyName, setFriendlyName] = useState('')
  const [code, setCode] = useState('')
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(state?.notice ?? null)
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; code?: string }>({})
  const [lockMessage, setLockMessage] = useState<string | null>(null)

  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state?.notice) clearSessionNotice()
  }, [state?.notice, clearSessionNotice])

  useEffect(() => {
    if (step === 'two_factor') codeRef.current?.focus()
  }, [step])

  function finish(result: LoginSuccess) {
    push({ tone: 'good', title: `Welcome back, ${result.user.displayName}` })
    navigate(state?.from ?? '/dashboard', { replace: true })
  }

  async function onSubmitCredentials(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setNotice(null)
    setLockMessage(null)
    setFieldErrors({})

    try {
      const result = await login(email, password)
      if (result.authenticated) {
        finish(result)
        return
      }
      setSessionId(result.sessionId)
      setFriendlyName(result.displayName)
      setStep('two_factor')
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'account_locked') {
          setLockMessage(lockoutMessage(error))
        } else if (error.code === 'validation_failed') {
          const mapped: typeof fieldErrors = {}
          for (const issue of error.issues) {
            if (issue.field === 'email' || issue.field === 'password') mapped[issue.field] = issue.message
          }
          setFieldErrors(mapped)
          if (Object.keys(mapped).length === 0) setNotice(error.message)
        } else {
          setNotice(error.message)
        }
      } else {
        setNotice('Digital Guardian could not be reached. Check your connection and try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function onSubmitCode(event: FormEvent | null, value = code) {
    event?.preventDefault()
    if (busy || value.trim().length === 0) return
    setBusy(true)
    setNotice(null)
    setFieldErrors({})

    try {
      const result = await submitMfa(sessionId, value.trim())
      push({ tone: 'good', title: `Welcome back, ${result.user.displayName}`, description: 'Two-step verification passed.' })
      navigate(state?.from ?? '/dashboard', { replace: true })
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'account_locked') {
          setLockMessage(lockoutMessage(error))
          setStep('credentials')
        } else if (error.code === 'validation_failed') {
          setFieldErrors({ code: error.issues.find((issue) => issue.field === 'code')?.message ?? error.message })
        } else {
          setNotice(error.message)
        }
      } else {
        setNotice('Digital Guardian could not be reached. Check your connection and try again.')
      }
      setCode('')
      codeRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={step === 'credentials' ? 'Welcome back to Digital Guardian' : friendlyName ? `Two-step for ${friendlyName}` : 'Two-step verification'}
      subtitle={
        step === 'credentials'
          ? 'Your password, plus a code from your authenticator app if you switched two-step verification on.'
          : 'Your password alone cannot open this account. Enter the current six-digit code, or one of the recovery codes you saved.'
      }
      aside={
        <>
          <AuthPoint icon={<Gauge className="size-4" />} title="A score that explains itself" text="Every factor shows what it measured and what would raise it." />
          <AuthPoint icon={<ScanSearch className="size-4" />} title="Check before you click" text="Paste a link or a whole message and read the reasons behind the verdict." />
          <AuthPoint icon={<LockKeyhole className="size-4" />} title="No outside passwords" text="Digital Guardian never asks for the password of another service." />
        </>
      }
      footer={
        step === 'credentials' ? (
          <p>
            New here?{' '}
            <Link to="/register" className="font-semibold text-brand hover:underline">
              Create an account
            </Link>
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-x-2">
            <button
              type="button"
              onClick={() => {
                setRecoveryMode((value) => !value)
                setCode('')
                setNotice(null)
                codeRef.current?.focus()
              }}
              className="font-semibold text-brand hover:underline"
            >
              {recoveryMode ? 'Use my app code instead' : 'Use a recovery code'}
            </button>
            <span className="text-faint">or</span>
            <button type="button" onClick={() => setStep('credentials')} className="font-semibold text-brand hover:underline">
              sign in with another address
            </button>
          </p>
        )
      }
    >
      {lockMessage ? (
        <Alert tone="danger" title="Sign-in is paused" Icon={ShieldCheck} className="mb-4">
          {lockMessage}
        </Alert>
      ) : null}

      {step === 'credentials' ? (
        <form onSubmit={onSubmitCredentials} className="stagger space-y-4" noValidate>
          {notice ? <Alert tone="danger" title="We could not sign you in" Icon={ShieldCheck}>{notice}</Alert> : null}

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
              name="password"
              autoComplete="current-password"
              required
              value={password}
              error={fieldErrors.password}
              onChange={(event) => setPassword(event.target.value)}
              hint={
                policy
                  ? `Sign-in pauses for ${plural(policy.accountLockMinutes, 'minute')} after ${policy.maxFailedLogins} failed attempts.`
                  : undefined
              }
            />
            <div className="mt-2 flex justify-end">
              <Link to="/forgot-password" className="text-sm font-medium text-brand hover:underline">
                Forgot your password?
              </Link>
            </div>
          </div>

          <Button type="submit" size="lg" fullWidth loading={busy}>
            {busy ? 'Checking…' : 'Sign in'}
          </Button>

          <p role="status" aria-live="polite" className="text-xs text-faint">
            {busy ? 'Verifying your credentials…' : 'Your password is only ever stored as an argon2id hash.'}
          </p>
        </form>
      ) : (
        <form onSubmit={onSubmitCode} className="stagger space-y-4" noValidate>
          {notice ? <Alert tone="danger" title="That did not verify" Icon={ShieldCheck}>{notice}</Alert> : null}

          <TextField
            ref={codeRef}
            label={recoveryMode ? 'Recovery code' : 'Authenticator code'}
            name="code"
            autoComplete={recoveryMode ? 'off' : 'one-time-code'}
            inputMode={recoveryMode ? 'text' : 'numeric'}
            required
            value={code}
            error={fieldErrors.code}
            onChange={(event) => {
              const next = recoveryMode ? event.target.value.toUpperCase() : event.target.value.replace(/\D/g, '').slice(0, 6)
              setCode(next)
              if (!recoveryMode && next.length === 6) void onSubmitCode(null, next)
            }}
            placeholder={recoveryMode ? 'XXXXX-XXXXX' : '123456'}
            hint={
              recoveryMode
                ? 'Each recovery code works exactly once. Keep the rest for when your phone is not with you.'
                : 'Six digits, valid for 30 seconds. It submits as soon as the sixth digit lands.'
            }
            className={recoveryMode ? 'font-mono tracking-[0.14em]' : 'text-center font-mono text-lg tracking-[0.35em]'}
          />

          <Button type="submit" size="lg" fullWidth loading={busy}>
            {busy ? 'Checking your code…' : 'Verify and continue'}
          </Button>

          <p role="status" className="text-xs text-faint">
            This sign-in request expires in 5 minutes. Nothing is readable until it does.
          </p>
        </form>
      )}
    </AuthLayout>
  )
}
