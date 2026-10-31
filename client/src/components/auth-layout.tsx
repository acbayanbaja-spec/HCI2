import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'

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
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between border-r border-line bg-surface/70 px-10 py-12 lg:flex">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[11px] bg-brand text-brand-ink">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-ink">Digital Guardian</span>
        </Link>

        <div className="max-w-md">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Know where you stand with your digital life.</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            A score that explains itself, a link checker that shows its reasoning, and guided steps for the moment something goes
            wrong.
          </p>
          {aside ? <div className="mt-8 space-y-3">{aside}</div> : null}
        </div>

        <p className="text-xs text-faint">
          Digital Guardian never asks for the password of another service, and does not read your accounts behind your back.
        </p>
      </aside>

      <main className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <Link to="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-[10px] bg-brand text-brand-ink">
              <ShieldCheck className="size-4.5" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold text-ink">Digital Guardian</span>
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>

          <div className="mt-7">{children}</div>

          {footer ? <div className="mt-6 text-sm text-muted">{footer}</div> : null}
        </div>
      </main>
    </div>
  )
}

export function AuthPoint({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-[var(--radius-field)] border border-line bg-sunken/50 px-3.5 py-3">
      <span className="mt-0.5 text-brand" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-xs leading-relaxed text-muted">{text}</p>
      </div>
    </div>
  )
}
