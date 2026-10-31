import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  Bell,
  ChevronDown,
  Gauge,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  ScanSearch,
  Settings,
  ShieldCheck,
  Sun,
  Boxes,
  X,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { api } from '../lib/api'
import { onAlertsChanged } from '../lib/alert-bus'
import { useAuth } from '../state/auth'
import { useTheme } from '../state/theme'
import { useToast } from '../state/toast'
import { useResource } from '../lib/use-resource'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', Icon: Gauge },
  { to: '/accounts', label: 'My accounts', Icon: Boxes },
  { to: '/check-link', label: 'Check a link', Icon: ScanSearch },
  { to: '/recommendations', label: 'Recommendations', Icon: ListChecks },
  { to: '/alerts', label: 'Alerts', Icon: Bell },
  { to: '/activity', label: 'Activity', Icon: Activity },
  { to: '/settings/profile', label: 'Settings', Icon: Settings },
]

function navItemClasses(isActive: boolean) {
  return cn(
    'flex items-center gap-3 rounded-[var(--radius-field)] px-3 py-2.5 text-sm font-medium transition',
    isActive ? 'bg-brand-soft text-ink shadow-[inset_2px_0_0_var(--brand)]' : 'text-muted hover:bg-sunken hover:text-ink',
  )
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-[11px] bg-brand text-brand-ink shadow-sm">
        <ShieldCheck className="size-5" aria-hidden="true" />
      </span>
      {!compact ? (
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight text-ink">Digital Guardian</span>
          <span className="block text-[0.7rem] uppercase tracking-[0.12em] text-faint">Personal security</span>
        </span>
      ) : null}
    </div>
  )
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1" aria-label="Main">
      {NAV.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => navItemClasses(isActive)} onClick={onNavigate}>
          {({ isActive }) => (
            <>
              <Icon className="size-[1.05rem] shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
              {isActive ? <span className="sr-only">(current page)</span> : null}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function UnreadBadge() {
  const location = useLocation()
  const { data, reload } = useResource<{ unread: number }>(
    (signal) => api.get('/api/notifications/unread-count', { signal }),
    [location.pathname],
  )

  useEffect(() => onAlertsChanged(reload), [reload])

  const unread = data?.unread ?? 0
  if (unread === 0) return null
  return (
    <span
      className="ml-auto min-w-5 rounded-full bg-warn px-1.5 text-center text-[0.7rem] font-bold leading-5 text-white dark:text-black"
      aria-label={`${unread} unread alert${unread === 1 ? '' : 's'}`}
    >
      {unread > 99 ? '99+' : unread}
    </span>
  )
}

function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme()
  const { push } = useToast()
  const [saving, setSaving] = useState(false)
  const next = resolved === 'dark' ? 'light' : 'dark'
  const Icon = resolved === 'dark' ? Sun : Moon

  // The account owns the preference, so a quick toggle has to be saved too -
  // otherwise the header and the profile screen would disagree on another device.
  async function toggle() {
    if (saving) return
    setSaving(true)
    const previous = preference
    setPreference(next)
    try {
      await api.put('/api/settings/preferences', { theme: next })
    } catch (error) {
      setPreference(previous)
      push({ tone: 'danger', title: 'Theme was not saved', description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      className="flex size-9 items-center justify-center rounded-[var(--radius-field)] border border-line text-muted transition hover:bg-sunken hover:text-ink disabled:opacity-60"
      title={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only">{resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</span>
    </button>
  )
}

function UserMenu({ onSignOut, busy }: { onSignOut: () => void; busy: boolean }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 items-center gap-2 rounded-[var(--radius-field)] border border-line px-2 text-sm text-ink transition hover:bg-sunken"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-brand-soft text-[0.7rem] font-bold uppercase text-ink">
          {user?.displayName.slice(0, 1) ?? '?'}
        </span>
        <span className="hidden max-w-28 truncate font-medium sm:block">{user?.displayName ?? 'Account'}</span>
        <ChevronDown className="size-3.5 text-faint" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="animate-rise absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-pop)]"
        >
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-ink">{user?.displayName}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
            <p className="mt-1 text-[0.7rem] uppercase tracking-[0.1em] text-faint">
              {user?.role === 'admin' ? 'Administrator' : 'Personal account'}
            </p>
          </div>
          <div className="p-1">
            <NavLink
              to="/settings/security"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted transition hover:bg-sunken hover:text-ink"
            >
              <ShieldCheck className="size-4" aria-hidden="true" /> Security &amp; devices
            </NavLink>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onSignOut()
              }}
              disabled={busy}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted transition hover:bg-sunken hover:text-ink disabled:opacity-60"
            >
              <LogOut className="size-4" aria-hidden="true" /> {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function AppShell() {
  const { logout } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => setDrawer(false), [location.pathname])

  async function signOut() {
    setSigningOut(true)
    try {
      await logout()
      push({ tone: 'good', title: 'Signed out', description: 'This device session was closed.' })
      navigate('/login', { replace: true })
    } catch {
      push({ tone: 'danger', title: 'Could not sign out', description: 'The service did not answer. Try again.' })
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <aside className="hidden border-r border-line bg-surface/60 px-4 py-5 lg:flex lg:flex-col">
        <div className="px-1">
          <Brand />
        </div>
        <div className="mt-6 flex-1">
          <NavLinks />
        </div>
        <p className="mt-6 rounded-[var(--radius-field)] border border-line bg-sunken/60 px-3 py-2.5 text-xs leading-relaxed text-muted">
          Digital Guardian never asks for the password of another service. Records are what you tell us, and what you check here.
        </p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-canvas/85 px-4 py-3 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="flex size-9 items-center justify-center rounded-[var(--radius-field)] border border-line text-muted transition hover:bg-sunken hover:text-ink lg:hidden"
          >
            <Menu className="size-4" aria-hidden="true" />
            <span className="sr-only">Open navigation</span>
          </button>
          <div className="lg:hidden">
            <Brand compact />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <NavLink
              to="/alerts"
              className="relative flex size-9 items-center justify-center rounded-[var(--radius-field)] border border-line text-muted transition hover:bg-sunken hover:text-ink"
              aria-label="Alerts"
            >
              <Bell className="size-4" aria-hidden="true" />
              <UnreadBadge />
            </NavLink>
            <UserMenu onSignOut={signOut} busy={signingOut} />
          </div>
        </header>

        {drawer ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/55" onClick={() => setDrawer(false)} aria-hidden="true" />
            <div role="dialog" aria-modal="true" aria-label="Site navigation" className="animate-rise absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <Brand />
                <button
                  type="button"
                  onClick={() => setDrawer(false)}
                  className="rounded-md p-1.5 text-faint transition hover:bg-sunken hover:text-ink"
                >
                  <X className="size-5" aria-hidden="true" />
                  <span className="sr-only">Close navigation</span>
                </button>
              </div>
              <div className="mt-5">
                <NavLinks onNavigate={() => setDrawer(false)} />
              </div>
            </div>
          </div>
        ) : null}

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>

        <footer className="border-t border-line px-4 py-5 text-xs text-faint sm:px-6 lg:px-8">
          <p>
            Digital Guardian explains its score and reasons. A clean result is not a guarantee of safety - see each check for what it
            can and cannot see.
          </p>
        </footer>
      </div>
    </div>
  )
}
