import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Card({ className, children, as: Tag = 'section' }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' | 'li' }) {
  return (
    <Tag className={cn('card-hover rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]', className)}>{children}</Tag>
  )
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  className,
  titleId,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
  titleId?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <span className="mt-0.5 text-brand" aria-hidden="true">{icon}</span> : null}
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-4 py-4 sm:px-5', className)}>{children}</div>
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5', className)}>{children}</div>
}

/** Page-level heading: the h1 every route needs for landmarks and screen readers. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-enter mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.7rem]">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
