import { useState } from 'react'
import { CircleCheck, Flag, Link2 } from 'lucide-react'
import { Card, CardBody, CardFooter, CardHeader } from './ui/card'
import { Button } from './ui/button'
import { Alert, SeverityBadge } from './ui/feedback'
import type { AnalysisResult } from '../lib/api-types'
import { cn } from '../lib/cn'
import { TONE_CLASSES, severityDescriptor, verdictDescriptor } from '../lib/severity'
import { formatDateTime } from '../lib/format'

const VERDICT_ORDER = ['critical', 'warning', 'caution', 'info'] as const

export function AnalysisResultView({ result, onReport }: { result: AnalysisResult; onReport: (result: AnalysisResult) => void }) {
  const descriptor = verdictDescriptor(result.verdict)
  const [showLinks, setShowLinks] = useState(false)

  const indicators = [...result.indicators].sort(
    (a, b) => VERDICT_ORDER.indexOf(b.severity) - VERDICT_ORDER.indexOf(a.severity) || b.weight - a.weight,
  )

  return (
    <Card aria-label="Check result">
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <SeverityBadge descriptor={descriptor} large />
            <span className="text-sm font-normal text-muted">risk {result.riskScore}/100</span>
          </span>
        }
        description={descriptor.description}
        action={
          <Button size="sm" variant="secondary" onClick={() => onReport(result)} icon={<Flag className="size-3.5" aria-hidden="true" />}>
            Report it
          </Button>
        }
      />

      <CardBody className="space-y-4">
        {indicators.length === 0 ? (
          <div className="flex items-start gap-3 rounded-[var(--radius-field)] border border-line bg-sunken/50 px-3.5 py-3">
            <CircleCheck className={cn('mt-0.5 size-4 shrink-0', TONE_CLASSES.good.text)} aria-hidden="true" />
            <p className="text-sm text-ink">
              Nothing matched. The engine looks at the address itself, the domain, and the words people use to rush you - not at
              what the page claims to be.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {indicators.map((indicator) => {
              const tone = severityDescriptor(indicator.severity)
              const classes = TONE_CLASSES[tone.tone]
              return (
                <li key={`${indicator.code}-${indicator.label}`} className={cn('rounded-[var(--radius-field)] border px-3.5 py-3', classes.border, classes.soft)}>
                  <div className="flex items-start gap-2.5">
                    <span className={cn('mt-0.5 shrink-0', classes.text)}>
                      <tone.Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{indicator.label}</p>
                      <p className="mt-0.5 text-sm text-ink/90">{indicator.detail}</p>
                      <p className={cn('mt-1 text-sm font-medium', classes.text)}>{indicator.advice}</p>
                      <p className="mt-1 text-[0.7rem] uppercase tracking-[0.08em] text-faint">
                        {tone.label} · weight {indicator.weight}
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {result.guidance.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-ink">What to do</h3>
            <ol className="mt-2 space-y-1.5 text-sm text-muted">
              {result.guidance.map((line, index) => (
                <li key={line} className="flex gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-[0.7rem] font-semibold text-ink">
                    {index + 1}
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {result.linksFound.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setShowLinks((value) => !value)}
              aria-expanded={showLinks}
              className="inline-flex items-center gap-2 text-sm font-semibold text-ink transition hover:text-brand"
            >
              <Link2 className="size-4" aria-hidden="true" />
              {result.linksFound.length === 1 ? 'One link found inside this message' : `${result.linksFound.length} links found inside this message`}
            </button>
            {showLinks ? (
              <ul className="mt-2 space-y-1 rounded-[var(--radius-field)] border border-line bg-sunken/50 px-3.5 py-3">
                {result.linksFound.map((link) => (
                  <li key={link} className="break-all font-mono text-xs text-muted">
                    {link}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-faint">Shown as text only. Nothing here is opened or fetched.</p>
            )}
          </div>
        ) : null}
      </CardBody>

      <CardFooter className="flex-col items-start gap-2 sm:flex-row sm:items-center">
        <p className="text-xs leading-relaxed text-faint">{result.disclaimer}</p>
        <p className="shrink-0 text-xs text-faint" title={formatDateTime(result.createdAt)}>
          Engine v{result.engineVersion} · {formatDateTime(result.createdAt)}
        </p>
      </CardFooter>
    </Card>
  )
}

export function AnalysisDisclaimer({ className }: { className?: string }) {
  return (
    <Alert tone="info" title="What this check can and cannot see" Icon={CircleCheck} className={className}>
      <p className="text-sm">
        The analyzer reads the text you paste. It does not visit the site, download anything, or see what a page does after it
        loads. A clean result is not a guarantee of safety.
      </p>
    </Alert>
  )
}
