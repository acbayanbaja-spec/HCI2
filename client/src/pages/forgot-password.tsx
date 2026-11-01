import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Mail, ShieldCheck } from 'lucide-react'
import { AuthLayout } from '../components/auth-layout'
import { Button } from '../components/ui/button'
import { TextField } from '../components/ui/field'
import { Alert } from '../components/ui/feedback'
import { ApiError } from '../lib/api'
import { api } from '../lib/api'
import { useAuth } from '../state/auth'

export function ForgotPasswordPage() {
  const { policy } = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const outbox = policy?.mailDelivery === 'outbox'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setFieldError(null)

    try {
      await api.post('/api/auth/forgot-password', { email: email.trim() }, { skipRefresh: true })
      setSent(true)
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'validation_failed') {
        setFieldError(cause.issues[0]?.message ?? cause.message)
      } else if (cause instanceof ApiError && cause.code === 'rate_limited') {
        setError(cause.message)
      } else {
        setError('Digital Guardian could not be reached. Check your connection and try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={sent ? 'Check your email' : 'Reset your password'}
      subtitle={
        sent
          ? 'If that address has an account, a link to choose a new password is on its way.'
          : 'Enter the address on your account. We answer the same way whether or not it exists, so this page cannot be used to list people.'
      }
      footer={
        <p>
          Remembered it?{' '}
          <Link to="/login" className="font-semibold text-brand hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <Alert tone="good" title="Request received" Icon={Mail}>
            <p className="text-sm">
              The link is valid for one use and expires shortly. Opening it takes you straight to a page for choosing a new
              password.
            </p>
          </Alert>

          {outbox ? (
            <Alert tone="watch" title="This development setup does not send mail" Icon={ShieldCheck}>
              <p className="text-sm">
                Without SMTP credentials, Digital Guardian writes the message to <code className="font-mono text-xs">server/.outbox</code>{' '}
                instead of sending it. Open the newest file there to get your reset link.
              </p>
            </Alert>
          ) : null}

          <div>
            <Button variant="secondary" fullWidth loading={busy} onClick={() => setSent(false)}>
              Use a different address
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="stagger space-y-4" noValidate>
          {error ? <Alert tone="danger" title="The request failed" Icon={ShieldCheck}>{error}</Alert> : null}

          <TextField
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            error={fieldError}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />

          <Button type="submit" size="lg" fullWidth loading={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </Button>

          <p className="text-xs leading-relaxed text-faint">
            Changing your password signs every device out of Digital Guardian. If you suspect someone else knows it, switch on
            two-step verification once you are back in.
          </p>
        </form>
      )}
    </AuthLayout>
  )
}
