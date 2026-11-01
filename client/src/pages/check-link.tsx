import { useState, type FormEvent } from 'react'
import { ClipboardType, Flag, History, Link2, ScanSearch, ShieldCheck } from 'lucide-react'
import { Card, CardBody, CardFooter, CardHeader, PageHeader } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { SelectField, TextArea, TextField } from '../components/ui/field'
import { Dialog, DialogFooter } from '../components/ui/dialog'
import { AnalysisDisclaimer, AnalysisResultView } from '../components/analysis-result'
import { Alert, Badge, EmptyState, ErrorState, SeverityBadge, Skeleton } from '../components/ui/feedback'
import { ApiError, api } from '../lib/api'
import type { AnalysisHistoryItem, AnalysisKind, AnalysisResult, ContentReport } from '../lib/api-types'
import { cn } from '../lib/cn'
import { formatRelative } from '../lib/format'
import { verdictDescriptor } from '../lib/severity'
import { useResource } from '../lib/use-resource'
import { useToast } from '../state/toast'

const KIND_OPTIONS = [
  { value: 'url', label: 'A link' },
  { value: 'message', label: 'A message (SMS, chat, post)' },
  { value: 'email', label: 'An email' },
]

const PLACEHOLDERS: Record<AnalysisKind, string> = {
  url: 'https://paypa1-secure-login.com/signin',
  message: 'URGENT: your account will be closed in 24 hours. Confirm here: https://…',
  email: 'Paste the whole email, subject line included. The more text, the more the engine can read.',
}

const STATUS_LABEL: Record<string, { label: string; tone: 'neutral' | 'watch' | 'good' | 'danger' }> = {
  new: { label: 'Waiting for review', tone: 'watch' },
  reviewing: { label: 'Under review', tone: 'watch' },
  confirmed: { label: 'Confirmed scam', tone: 'danger' },
  dismissed: { label: 'Closed - not a scam', tone: 'good' },
}

export function CheckLinkPage() {
  const { push } = useToast()
  const [kind, setKind] = useState<AnalysisKind>('url')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [openingAnalysis, setOpeningAnalysis] = useState<string | null>(null)

  const [reportFor, setReportFor] = useState<AnalysisResult | null>(null)
  const [reportTarget, setReportTarget] = useState('')
  const [reportBrand, setReportBrand] = useState('')
  const [reportReason, setReportReason] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)

  const history = useResource<{ analyses: AnalysisHistoryItem[] }>((signal) => api.get('/api/analyses', { query: { limit: 12 }, signal }), [result?.id])
  const reports = useResource<{ reports: ContentReport[] }>((signal) => api.get('/api/reports', { signal }), [reportFor?.id])

  async function analyze(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (input.trim().length < 3) {
      setFieldError('Paste a link or the message you are unsure about.')
      return
    }
    setFieldError(null)
    setError(null)
    setBusy(true)

    try {
      const next = await api.post<AnalysisResult>('/api/analyze', { kind, input: input.trim() })
      setResult(next)
      history.reload()
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'validation_failed') {
        setFieldError(cause.issues[0]?.message ?? cause.message)
      } else if (cause instanceof ApiError && cause.code === 'rate_limited') {
        setError(cause.message)
      } else {
        setError('The check could not be completed. Nothing was sent anywhere - try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function openAnalysis(item: AnalysisHistoryItem) {
    if (openingAnalysis) return
    setOpeningAnalysis(item.id)
    setError(null)
    try {
      setResult(await api.get<AnalysisResult>(`/api/analyses/${item.id}`))
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That result could not be reopened.')
    } finally {
      setOpeningAnalysis(null)
    }
  }

  function startReport(target: AnalysisResult) {
    setReportFor(target)
    setReportTarget(kind === 'url' && input.trim() ? input.trim() : (target.linksFound[0] ?? input.trim()))
    setReportBrand('')
    setReportReason('')
    setReportError(null)
  }

  async function submitReport(event: FormEvent) {
    event.preventDefault()
    if (reportBusy || !reportFor) return
    if (reportTarget.trim().length < 3) {
      setReportError('Say what you are reporting - a link, a number, or the wording that worried you.')
      return
    }
    setReportBusy(true)
    setReportError(null)
    try {
      const created = await api.post<{ message?: string }>('/api/reports', {
        analysisId: reportFor.id,
        target: reportTarget.trim(),
        claimedBrand: reportBrand.trim() || null,
        reason: reportReason.trim() || null,
      })
      push({ tone: 'good', title: 'Report filed', description: created.message })
      setReportFor(null)
      reports.reload()
    } catch (cause) {
      setReportError(cause instanceof ApiError ? cause.message : 'The report was not filed.')
    } finally {
      setReportBusy(false)
    }
  }

  const analyses = history.data?.analyses ?? []

  return (
    <>
      <PageHeader
        title="Check a link or message"
        description="Paste what you received. The engine reads the words and the address, shows every pattern it matched, and never opens anything."
      />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr] lg:items-start">
        <div className="space-y-5">
          <Card>
            <CardHeader title="What are you unsure about?" icon={<ScanSearch className="size-4" />} />
            <CardBody>
              <form onSubmit={analyze} className="stagger space-y-4" noValidate>
                <SelectField label="Type" value={kind} options={KIND_OPTIONS} onChange={(event) => setKind(event.target.value as AnalysisKind)} />

                {kind === 'url' ? (
                  <TextField
                    label="The link"
                    value={input}
                    error={fieldError}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={PLACEHOLDERS.url}
                    hint="Paste it whole, including anything after the slash."
                  />
                ) : (
                  <TextArea
                    label={kind === 'email' ? 'The email' : 'The message'}
                    value={input}
                    error={fieldError}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={PLACEHOLDERS[kind]}
                    rows={7}
                    hint="Everything you have: greeting, wording, and any links inside."
                  />
                )}

                {error ? <Alert tone="danger" title="The check did not run" Icon={ShieldCheck}>{error}</Alert> : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" loading={busy} size="lg">
                    {busy ? 'Reading it now…' : 'Check it'}
                  </Button>
                  {input ? (
                    <Button
                      variant="ghost"
                      size="lg"
                      onClick={() => {
                        setInput('')
                        setFieldError(null)
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
              </form>
            </CardBody>
          </Card>

          {busy && !result ? <Skeleton className="h-64 w-full rounded-[var(--radius-card)]" /> : null}

          {result ? <AnalysisResultView result={result} onReport={startReport} /> : null}

          {!result && !busy ? (
            <AnalysisDisclaimer />
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Your checks" description="Kept so you can compare what you saw earlier." icon={<History className="size-4" />} />
            <CardBody className="p-0">
              {history.loading ? (
                <div className="px-4 sm:px-5">
                  <Skeleton className="h-28 w-full" />
                </div>
              ) : history.error ? (
                <div className="px-4 sm:px-5">
                  <ErrorState message={history.error.message} onRetry={history.reload} title="History did not load" />
                </div>
              ) : analyses.length === 0 ? (
                <div className="px-4 py-5 sm:px-5">
                  <EmptyState icon={<Link2 className="size-6" />} title="Nothing checked yet" description="Your pasted text is only ever kept as a short excerpt." className="border-0 bg-transparent px-0 py-2" />
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {analyses.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => openAnalysis(item)}
                        disabled={openingAnalysis === item.id}
                        className={cn(
                          'flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-sunken sm:px-5',
                          result?.id === item.id && 'bg-sunken',
                          openingAnalysis === item.id && 'cursor-progress opacity-70',
                        )}
                      >
                        <SeverityBadge descriptor={verdictDescriptor(item.verdict)} />
                        <span className="min-w-0 flex-1">
                          <span className="block line-clamp-2 text-sm text-ink">{item.inputExcerpt}</span>
                          <span className="mt-0.5 block text-xs text-faint">
                            {item.inputKind === 'url' ? 'Link' : item.inputKind === 'email' ? 'Email' : 'Message'} · risk{' '}
                            {item.riskScore} · {formatRelative(item.createdAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Your reports" description="Filed reports go to an administrator; you see the outcome here." icon={<Flag className="size-4" />} />
            <CardBody className="p-0">
              {reports.loading ? (
                <div className="px-4 sm:px-5">
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : reports.error ? (
                <div className="px-4 sm:px-5">
                  <ErrorState message={reports.error.message} onRetry={reports.reload} title="Reports did not load" />
                </div>
              ) : !reports.data || reports.data.reports.length === 0 ? (
                <div className="px-4 py-5 sm:px-5">
                  <EmptyState
                    icon={<Flag className="size-6" />}
                    title="No reports filed"
                    description="When a check looks like a scam, use Report it so the pattern is recorded for review."
                    className="border-0 bg-transparent px-0 py-2"
                  />
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {reports.data.reports.map((report) => {
                    const status = STATUS_LABEL[report.status] ?? { label: report.status, tone: 'neutral' as const }
                    return (
                      <li key={report.id} className="px-4 py-3 sm:px-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={status.tone}>{status.label}</Badge>
                          <span className="text-xs text-faint">{formatRelative(report.createdAt)}</span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-sm text-ink">{report.target}</p>
                        {report.adminNotes ? <p className="mt-1 text-sm text-muted">Reviewer: {report.adminNotes}</p> : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
            <CardFooter>
              <p className="text-xs text-faint">Reports store an excerpt and a one-way hash of what you paste, never the whole message.</p>
            </CardFooter>
          </Card>
        </div>
      </div>

      <Dialog
        open={reportFor !== null}
        onClose={() => setReportFor(null)}
        title="Report this as suspicious"
        description="It goes to the administrator queue. Nothing is sent to the site or person you are reporting."
        footer={
          <DialogFooter
            cancel={() => setReportFor(null)}
            confirm={
              <Button type="submit" form="report-form" loading={reportBusy}>
                File report
              </Button>
            }
          />
        }
      >
        <form id="report-form" onSubmit={submitReport} className="space-y-4" noValidate>
          {reportError ? <Alert tone="danger" title="Not filed" Icon={ShieldCheck}>{reportError}</Alert> : null}

          <TextArea
            label="What are you reporting?"
            value={reportTarget}
            onChange={(event) => setReportTarget(event.target.value)}
            rows={3}
            required
            hint="A link, a phone number, or the exact wording."
          />
          <TextField
            label="Which brand is it pretending to be? (optional)"
            value={reportBrand}
            onChange={(event) => setReportBrand(event.target.value)}
            placeholder="GCash, PayPal, your bank…"
          />
          <TextArea
            label="Why does it worry you? (optional)"
            value={reportReason}
            onChange={(event) => setReportReason(event.target.value)}
            rows={3}
            placeholder="It asked me to approve a payment I did not make."
          />

          <div className="flex items-start gap-2.5 rounded-[var(--radius-field)] border border-line bg-sunken/50 px-3.5 py-3">
            <ClipboardType className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-muted">
              If you already entered a password or code, change it at the service itself now - then open your alerts and record what
              happened. Reporting alone does not protect the account.
            </p>
          </div>
        </form>
      </Dialog>
    </>
  )
}
