import { CircleCheck, X } from 'lucide-react'
import { cn } from '../lib/cn'
import type { GuidanceRule } from '../lib/password-guidance'

/** Live guidance only - the server has the final say, including its common-password list. */
export function PasswordRules({ rules, className }: { rules: GuidanceRule[]; className?: string }) {
  return (
    <ul className={cn('space-y-1.5', className)} aria-label="Password requirements">
      {rules.map((rule) => (
        <li key={rule.id} className="flex items-start gap-2 text-xs">
          <span className={cn('mt-0.5 shrink-0', rule.ok ? 'text-good' : 'text-faint')} aria-hidden="true">
            {rule.ok ? <CircleCheck className="size-3.5" /> : <X className="size-3.5" />}
          </span>
          <span className={rule.ok ? 'text-muted' : 'text-ink'}>
            {rule.label}
            <span className="sr-only">{rule.ok ? ' - met' : ' - not yet'}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
