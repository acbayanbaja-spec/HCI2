import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-ink hover:bg-brand-hover border border-transparent shadow-sm hover:shadow-md',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-sunken',
  ghost: 'bg-transparent text-ink border border-line hover:bg-sunken',
  danger: 'bg-warn text-white dark:text-black border border-transparent hover:opacity-90',
  quiet: 'bg-transparent text-muted border border-transparent hover:bg-sunken hover:text-ink',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-[0.95rem] gap-2',
}

/** The same classes power link-styled buttons, so a link and a button never look different by accident. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cn(
    'inline-flex items-center justify-center rounded-[var(--radius-field)] font-semibold transition',
    'disabled:cursor-not-allowed disabled:opacity-55',
    '[&:active]:translate-y-px',
    VARIANTS[variant],
    SIZES[size],
    extra,
  )
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  fullWidth?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClasses(variant, size, fullWidth ? "w-full" : undefined), className)}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}
