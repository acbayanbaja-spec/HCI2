import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Gauge, LockKeyhole, ScanSearch, ShieldCheck } from 'lucide-react'

/**
 * Shared frame for the signed-out screens: one brand column, one form column,
 * so signing in, registering and resetting a password all feel like one product.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  aside,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="auth-panel relative hidden flex-col justify-between border-r border-line px-10 py-12 lg:flex">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[11px] bg-brand text-brand-ink shadow-sm">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-ink">Digital Guardian</span>
        </Link>

        <div className="max-w-md">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-faint">Personal security</p>
          <h2 className="mt-3 text-[1.65rem] font-semibold leading-snug tracking-tight text-ink">
            Know where you stand with your digital life.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            A score that explains itself, a link checker that shows its reasoning, and guided steps for the moment something goes
            wrong.
          </p>
          <div className="stagger mt-8 space-y-3">
            {aside ?? (
              <>
                <AuthPoint icon={<Gauge className="size-4" />} title="A score that explains itself" text="Every factor shows what it measured and what would raise it." />
                <AuthPoint icon={<ScanSearch className="size-4" />} title="Check before you click" text="Paste a link or a whole message and read the reasons behind the verdict." />
                <AuthPoint icon={<LockKeyhole className="size-4" />} title="No outside passwords" text="Digital Guardian never asks for the password of another service." />
              </>
            )}
          </div>
        </div>

        <p className="max-w-sm text-xs leading-relaxed text-faint">
          Digital Guardian never asks for the password of another service, and does not read your accounts behind your back.
        </p>
      </aside>

      <main className="relative flex flex-col justify-center px-5 py-10 sm:px-10">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(520px_160px_at_50%_0%,color-mix(in_srgb,var(--brand)_12%,transparent),transparent)] lg:hidden"
          aria-hidden="true"
        />
        <div className="page-enter mx-auto w-full max-w-[26.5rem]">
          <Link to="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-[10px] bg-brand text-brand-ink">
              <ShieldCheck className="size-4" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold text-ink">Digital Guardian</span>
          </Link>

          <div className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-7">
            <h1 className="text-[1.55rem] font-semibold tracking-tight text-ink">{title}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{subtitle}</p>
            <div className="mt-6">{children}</div>
          </div>

          {footer ? <div className="mt-5 px-1 text-sm text-muted">{footer}</div> : null}
        </div>
      </main>
    </div>
  )
}

export function AuthPoint({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-[var(--radius-field)] border border-line bg-canvas/70 px-3.5 py-3 backdrop-blur-[2px]">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-xs leading-relaxed text-muted">{text}</p>
      </div>
    </div>
  )
}
