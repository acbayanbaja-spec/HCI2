import { cn } from '../lib/cn'
import type { ScoreBand } from '../lib/api-types'
import { TONE_CLASSES, bandDescriptor } from '../lib/severity'

const RADIUS = 46
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * The ring is decoration; the number, the band name and the "out of 100" text
 * are what a screen reader or a greyscale screen gets.
 */
export function ScoreMeter({ score, band, size = 148, className }: { score: number; band: ScoreBand; size?: number; className?: string }) {
  const descriptor = bandDescriptor(band)
  const tone = TONE_CLASSES[descriptor.tone]
  const clamped = Math.min(100, Math.max(0, Math.round(score)))
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--sunken)" strokeWidth="8" />
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            className={tone.text}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 600ms ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-semibold tabular-nums text-ink">{clamped}</span>
          <span className="text-xs font-medium uppercase tracking-[0.1em] text-faint">out of 100</span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="sr-only">Digital Safety Score {clamped} out of 100.</p>
        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tracking-[0.08em]', tone.soft, tone.text, tone.border)}>
          <descriptor.Icon className="size-3.5" aria-hidden="true" />
          {descriptor.label.toUpperCase()}
        </span>
      </div>
    </div>
  )
}
