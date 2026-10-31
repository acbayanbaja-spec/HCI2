import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MailCheck, ShieldCheck } from 'lucide-react'
import { AuthLayout } from '../components/auth-layout'
import { Alert, ErrorState, LoadingBlock } from '../components/ui/feedback'
import { ApiError, api } from '../lib/api'

type VerifyResult = { verified: boolean; message: string }

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const sent = useRef(false)

  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed' | 'missing'>(token ? 'working' : 'missing')
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!token || sent.current) return
    sent.current = true
    let cancelled = false

    api
      .post<VerifyResult>('/api/auth/verify-email', { token }, { skipRefresh: true })
      .then((response) => {
        if (cancelled) return
        setResult(response)
        setState('done')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setMessage(cause instanceof ApiError ? cause.message : 'Digital Guardian could not be reached. Try again in a moment.')
        setState('failed')
      })

    return () => {
      cancelled = true
    }
  }, [token])

  if (state === 'missing') {
    return (
      <AuthLayout title="This link is incomplete" subtitle="A confirmation link has to carry the token from the email you received.">
        <ErrorState title="No confirmation token in this address" message="Open the link from the email, or sign in and request a new one from Settings." />
        <div className="mt-4">
          <Link to="/login" className="font-semibold text-brand hover:underline">
            Go to sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={state === 'done' ? 'Email confirmed' : state === 'failed' ? 'That link did not work' : 'Confirming your email'}
      subtitle={
        state === 'done'
          ? 'Your address is verified, which is one of the things your safety score measures.'
          : state === 'failed'
            ? 'Confirmation links expire after 24 hours and work only once.'
            : 'Checking the token in the link now.'
      }
      footer={
        <p>
          <Link to="/login" className="font-semibold text-brand hover:underline">
            Go to sign in
          </Link>
        </p>
      }
    >
      {state === 'working' ? <LoadingBlock label="Confirming your email address" /> : null}

      {state === 'done' && result ? (
        <div className="space-y-4">
          <Alert tone="good" title={result.message} Icon={MailCheck}>
            <p className="text-sm">Sign in and switch on two-step verification next - it is the single largest move your score can make.</p>
          </Alert>
          <Link to="/login" className="block">
            <button type="button" className="w-full rounded-[var(--radius-field)] bg-brand px-4 py-2.5 text-sm font-semibold text-brand-ink transition hover:bg-brand-hover">
              Continue to sign in
            </button>
          </Link>
        </div>
      ) : null}

      {state === 'failed' ? (
        <ErrorState
          title="The address was not confirmed"
          message={message ?? undefined}
        />
      ) : null}

      {state === 'failed' ? (
        <p className="mt-4 flex items-start gap-2 text-xs text-faint">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          If you did not request this link, someone else may have typed your address. Nothing was changed on your account.
        </p>
      ) : null}
    </AuthLayout>
  )
}
