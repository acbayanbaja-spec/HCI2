import { Eye, EyeOff } from 'lucide-react'
import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

const CONTROL =
  'w-full rounded-[var(--radius-field)] border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint ' +
  'border-line-strong hover:border-brand/55 focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_18%,transparent)] disabled:opacity-60'

type ShellProps = {
  label: string
  htmlFor: string
  hint?: ReactNode
  error?: string | null
  required?: boolean
  children: ReactNode
  className?: string
}

function Shell({ label, htmlFor, hint, error, required, children, className }: ShellProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
        {required ? <span className="ml-1 text-warn" aria-hidden="true">*</span> : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm font-medium text-warn">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function describedBy(id: string, error?: string | null, hasHint = false) {
  if (error) return `${id}-error`
  return hasHint ? `${id}-hint` : undefined
}

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string
  hint?: ReactNode
  error?: string | null
  containerClassName?: string
  ref?: Ref<HTMLInputElement>
}

export function TextField({ label, hint, error, containerClassName, className, required, ...rest }: TextFieldProps) {
  const id = useId()
  return (
    <Shell label={label} htmlFor={id} hint={hint} error={error} required={required} className={containerClassName}>
      <input
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, Boolean(hint))}
        className={cn(CONTROL, error && 'border-warn', className)}
        {...rest}
      />
    </Shell>
  )
}

export type PasswordFieldProps = Omit<TextFieldProps, 'type'>

/** Show/hide is a plain button with a label change, not a tooltip-only icon. */
export function PasswordField({ label, hint, error, containerClassName, className, required, autoComplete = 'current-password', ...rest }: PasswordFieldProps) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  return (
    <Shell label={label} htmlFor={id} hint={hint} error={error} required={required} className={containerClassName}>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, Boolean(hint))}
          className={cn(CONTROL, 'pr-11 font-mono tracking-tight', error && 'border-warn', className)}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[var(--radius-field)] text-faint transition hover:text-ink"
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          <span className="sr-only">{visible ? 'Hide this password' : 'Show this password'}</span>
        </button>
      </div>
    </Shell>
  )
}

export type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  label: string
  hint?: ReactNode
  error?: string | null
  containerClassName?: string
}

export function TextArea({ label, hint, error, containerClassName, className, required, rows = 4, ...rest }: TextAreaProps) {
  const id = useId()
  return (
    <Shell label={label} htmlFor={id} hint={hint} error={error} required={required} className={containerClassName}>
      <textarea
        id={id}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, Boolean(hint))}
        className={cn(CONTROL, 'resize-y leading-relaxed', error && 'border-warn', className)}
        {...rest}
      />
    </Shell>
  )
}

export type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string
  hint?: ReactNode
  error?: string | null
  options: ReadonlyArray<{ value: string; label: string }>
  containerClassName?: string
}

export function SelectField({ label, hint, error, options, containerClassName, className, required, ...rest }: SelectFieldProps) {
  const id = useId()
  return (
    <Shell label={label} htmlFor={id} hint={hint} error={error} required={required} className={containerClassName}>
      <select
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, Boolean(hint))}
        className={cn(CONTROL, 'appearance-none bg-[length:1rem] pr-8', error && 'border-warn', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.6rem center',
        }}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Shell>
  )
}

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> & {
  label: string
  description?: ReactNode
  containerClassName?: string
}

export function CheckboxField({ label, description, containerClassName, className, checked, ...rest }: CheckboxProps) {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-2.5', containerClassName)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        className={cn('mt-0.5 size-4 shrink-0 rounded border border-line-strong bg-surface accent-[var(--brand)]', className)}
        {...rest}
      />
      <label htmlFor={id} className="text-sm leading-snug text-ink">
        {label}
        {description ? <span className="block text-muted">{description}</span> : null}
      </label>
    </div>
  )
}

export type SwitchProps = {
  label: string
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/** A real checkbox dressed as a switch: the accessible name and state stay native. */
export function SwitchField({ label, description, checked, onChange, disabled }: SwitchProps) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <label htmlFor={id} className="min-w-0 cursor-pointer text-sm">
        <span className="block font-medium text-ink">{label}</span>
        {description ? <span className="mt-0.5 block text-muted">{description}</span> : null}
      </label>
      <span className="relative shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer size-11 appearance-none rounded-full border border-line-strong bg-sunken transition checked:border-brand checked:bg-brand-soft cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-1/2 size-7 -translate-y-1/2 rounded-full border border-line bg-surface shadow-sm transition-all',
            checked ? 'left-[calc(100%-1.875rem)] border-brand' : 'left-1',
          )}
        />
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      </span>
    </div>
  )
}
