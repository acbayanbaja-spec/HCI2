import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { TONE_CLASSES, type SeverityDescriptor, type Tone } from '../../lib/severity'

export function Badge({
  tone = 'neutral',
  children,
  Icon,
  className,
  uppercase = false,
}: {
  tone?: Tone
  children: ReactNode
  Icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
  className?: string
  uppercase?: boolean
}) {
  const classes = TONE_CLASSES[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        classes.soft,
        classes.text,
        classes.border,
        uppercase && 'tracking-[0.08em]',
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

/**
 * Severity always travels with an icon and its written label, never as a colour
 * alone.
 */
export function SeverityBadge({ descriptor, className, large = false }: { descriptor: SeverityDescriptor; className?: string; large?: boolean }) {
  const { label, tone, Icon } = descriptor
  return (
    <Badge tone={tone} Icon={Icon} uppercase className={cn(large && 'px-3 py-1.5 text-sm', className)}>
      {label}
    </Badge>
  )
}

export function Alert({
  tone = 'info',
  title,
  children,
  Icon,
  action,
  className,
}: {
  tone?: Tone
  title: ReactNode
  children?: ReactNode
  Icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
  action?: ReactNode
  className?: string
}) {
  const classes = TONE_CLASSES[tone]
  const urgent = tone === 'warn' || tone === 'danger'
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-[var(--radius-field)] border px-3.5 py-3 text-sm', classes.soft, classes.border, className)}
    >
      {Icon ? <Icon className={cn('mt-0.5 size-4 shrink-0', classes.text)} aria-hidden="true" /> : null}
      <div className="min-w-0 flex-1">
        <p className={cn('font-semibold', classes.text)}>{title}</p>
        {children ? <div className="mt-1 space-y-1 text-ink">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('shimmer rounded-md', className)} />
}

export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  )
}

/** A request in flight should be announced, not just shown as grey bars. */
export function LoadingBlock({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-busy="true">
      <span className="sr-only">{label}…</span>
      <SkeletonList rows={2} />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-sunken/40 px-5 py-10 text-center', className)}>
      {icon ? <span className="text-faint" aria-hidden="true">{icon}</span> : null}
      <div className="max-w-md">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function ErrorState({
  title = 'This did not load',
  message,
  onRetry,
  className,
}: {
  title?: string
  message?: ReactNode
  onRetry?: () => void
  className?: string
}) {
  return (
    <div role="alert" className={cn('rounded-[var(--radius-card)] border border-warn/40 bg-warn-soft px-4 py-4', className)}>
      <h3 className="text-sm font-semibold text-warn">{title}</h3>
      {message ? <p className="mt-1 text-sm text-ink">{message}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-[var(--radius-field)] border border-warn/50 bg-surface px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-sunken"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function ProgressBar({ value, tone = 'info', label, className }: { value: number; tone?: Tone; label: string; className?: string }) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-sunken', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500', TONE_CLASSES[tone].bar)} style={{ width: `${clamped}%` }} />
    </div>
  )
}

export function Stat({ label, value, hint, tone = 'neutral' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-[var(--radius-field)] border border-line bg-sunken/50 px-3.5 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold', TONE_CLASSES[tone].text)}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}
