import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleCheck, Info, OctagonAlert, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/cn'
import { TONE_CLASSES, type Tone } from '../lib/severity'

export type Toast = { id: number; tone: Exclude<Tone, 'neutral'>; title: string; description?: string }

type ToastValue = {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastValue | null>(null)

const ICONS: Record<Exclude<Tone, 'neutral'>, LucideIcon> = {
  good: CircleCheck,
  watch: Info,
  warn: TriangleAlert,
  danger: OctagonAlert,
  info: Info,
}

const TITLES: Record<Exclude<Tone, 'neutral'>, string> = {
  good: 'Success',
  watch: 'Notice',
  warn: 'Warning',
  danger: 'Problem',
  info: 'Update',
}

const DURATION_MS = 6500

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++
      setToasts((current) => [...current.slice(-2), { ...toast, id }])
      window.setTimeout(() => dismiss(id), DURATION_MS)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live, not aria-alert: a confirmation should not interrupt a screen reader mid-sentence. */}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96" aria-live="polite" role="status">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone]
          const tone = TONE_CLASSES[toast.tone]
          return (
            <div
              key={toast.id}
              className={cn(
                'animate-rise pointer-events-auto flex items-start gap-3 rounded-[var(--radius-card)] border bg-surface p-3 shadow-[var(--shadow-pop)]',
                tone.border,
              )}
            >
              <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', tone.soft, tone.text)}>
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{toast.title}</p>
                <p className="sr-only">{TITLES[toast.tone]}:</p>
                {toast.description ? <p className="mt-0.5 break-words text-sm text-muted">{toast.description}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="-m-1 rounded-md p-1 text-faint transition hover:bg-sunken hover:text-ink"
              >
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">Dismiss this message</span>
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
