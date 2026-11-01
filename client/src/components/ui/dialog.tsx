import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { buttonClasses } from './button'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export type DialogProps = {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
  labelId?: string
}

/**
 * A native <dialog> would be nicer, but its close reasons and top-layer styling
 * differ enough across browsers that a hand-rolled trap is more predictable:
 * Escape closes, Tab stays inside, focus returns to the control that opened it.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', labelId = 'dialog-title' }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement
    document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.offsetParent !== null)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const index = items.indexOf(document.activeElement as HTMLElement)
      const next = event.shiftKey ? (index <= 0 ? items[items.length - 1] : items[index - 1]) : items[(index + 1) % items.length]
      if (next) {
        event.preventDefault()
        next.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = ''
      const restore = restoreRef.current as HTMLElement | null
      restore?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-6">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        className={cn(
          'dialog-enter relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[18px] border border-line bg-surface shadow-[var(--shadow-pop)] sm:rounded-[var(--radius-card)]',
          size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={labelId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-m-1 rounded-md p-1.5 text-faint transition hover:bg-sunken hover:text-ink"
          >
            <X className="size-5" aria-hidden="true" />
            <span className="sr-only">Close this dialog</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-sunken/40 px-5 py-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export function DialogFooter({ cancel, confirm }: { cancel: () => void; confirm: ReactNode }) {
  return (
    <>
      <button type="button" onClick={cancel} className={buttonClasses('secondary', 'md')}>
        Cancel
      </button>
      {confirm}
    </>
  )
}

/** Anything that cannot be undone goes through here, never a window.confirm(). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
  tone = 'danger',
  children,
}: {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  tone?: 'danger' | 'primary'
  children?: ReactNode
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <DialogFooter
          cancel={onCancel}
          confirm={
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              aria-busy={busy || undefined}
              className={cn(buttonClasses(tone === 'danger' ? 'danger' : 'primary', 'md'), busy && 'cursor-progress')}
            >
              {busy ? <span className="mr-1.5 inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : null}
              {confirmLabel}
            </button>
          }
        />
      }
    >
      {children}
    </Dialog>
  )
}
