import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../state/auth'
import { AppShell } from './app-shell'

function BootScreen() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-[14px] bg-brand text-brand-ink">
        <ShieldCheck className="size-6" aria-hidden="true" />
      </span>
      <p role="status" className="text-sm text-muted">
        Checking your session…
      </p>
    </div>
  )
}

/**
 * Hiding links is not authorization: this only decides what to render while the
 * backend enforces the same rule on every request it can serve.
 */
export function RequireAuth() {
  const { status, sessionNotice, clearSessionNotice } = useAuth()
  const location = useLocation()

  if (status === 'booting') return <BootScreen />
  if (status === 'signed_out') {
    const notice = sessionNotice
    clearSessionNotice()
    return <Navigate to="/login" replace state={{ notice, from: location.pathname + location.search }} />
  }
  return <AppShell />
}

/** Signed-in users have no business on the sign-in form. */
export function RedirectIfSignedIn() {
  const { status } = useAuth()
  if (status === 'signed_in') return <Navigate to="/dashboard" replace />
  return <Outlet />
}
