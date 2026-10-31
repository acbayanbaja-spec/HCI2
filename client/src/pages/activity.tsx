import { useState, type FormEvent } from 'react'
import { Activity, History, Search, ShieldCheck } from 'lucide-react'
import { Card, CardBody, CardHeader, PageHeader } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge, EmptyState, ErrorState, SeverityBadge, SkeletonList } from '../components/ui/feedback'
import { SelectField, TextField } from '../components/ui/field'
import { api } from '../lib/api'
import type { IndicatorSeverity, SecurityEvent } from '../lib/api-types'
import { formatDateTime, formatRelative, plural } from '../lib/format'
import { severityDescriptor } from '../lib/severity'
import { useResource } from '../lib/use-resource'

const CATEGORY_LABELS: Record<string, string> = {
  authentication: 'Signing in',
  session: 'Devices and sessions',
  mfa: 'Two-step verification',
  profile: 'Profile and contact details',
  account_asset: 'Account records',
  analysis: 'Link and message checks',
  report: 'Reports you filed',
  recommendation: 'Advice actions',
}

const CATEGORY_OPTIONS = [
  { value: '', label: 'All areas' },
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
]

const SEVERITY_OPTIONS = [
  { value: '', label: 'Any importance' },
  { value: 'info', label: 'Info' },
  { value: 'caution', label: 'Caution' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
]

type Filters = { search: string; category: string; severity: string; from: string; to: string }

const EMPTY_FILTERS: Filters = { search: '', category: '', severity: '', from: '', to: '' }

function eventLabel(eventType: string): string {
  return eventType.replace(/_/g, ' ')
}

function MetadataDetails({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (entries.length === 0) return null
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">Recorded details</summary>
      <dl className="mt-1.5 space-y-1 text-xs">
        {entries.map(([key, value]) => (
          <div key={key} className="flex flex-wrap gap-1.5">
            <dt className="font-medium text-faint">{eventLabel(key)}:</dt>
            <dd className="break-all text-muted">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

export function ActivityPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS)

  const resource = useResource<{ events: SecurityEvent[]; note: string }>(
    (signal) => api.get('/api/events', { query: { ...applied, limit: 100 }, signal }),
    [applied],
  )

  const filtering = Object.values(applied).some((value) => value !== '')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setApplied({ ...draft })
  }

  function reset() {
    setDraft(EMPTY_FILTERS)
    setApplied(EMPTY_FILTERS)
  }

  const events = resource.data?.events ?? []
  const countOf = (severity: IndicatorSeverity) => events.filter((event) => event.severity === severity).length

  return (
    <>
      <PageHeader
        title="Security activity"
        description="Every security action Digital Guardian recorded for your account, newest first."
        actions={
          filtering ? (
            <Button variant="secondary" onClick={reset}>
              Clear filters
            </Button>
          ) : null
        }
      />

      <Card className="mt-5" as="div">
        <CardHeader title="Find an event" description="Search the written message, or narrow by area, importance or date." icon={<Search className="size-4" />} />
        <CardBody className="p-0 sm:p-0">
          <form onSubmit={onSubmit} className="grid gap-3 px-4 pb-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
            <TextField
              label="Search"
              placeholder="password changed, sign-in, revoked…"
              value={draft.search}
              onChange={(event) => setDraft({ ...draft, search: event.target.value })}
              maxLength={120}
            />
            <SelectField
              label="Area"
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              options={CATEGORY_OPTIONS}
            />
            <SelectField
              label="Importance"
              value={draft.severity}
              onChange={(event) => setDraft({ ...draft, severity: event.target.value })}
              options={SEVERITY_OPTIONS}
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="From"
                type="date"
                value={draft.from}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              />
              <TextField label="To" type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" loading={resource.loading && filtering} variant="secondary">
                <Search className="size-4" aria-hidden="true" /> Apply filters
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <div className="mt-5">
        {resource.loading ? (
          <SkeletonList rows={5} />
        ) : resource.error ? (
          <ErrorState title="Your activity could not be loaded" message={resource.error.message} onRetry={resource.reload} />
        ) : events.length === 0 ? (
          <EmptyState
            icon={<History className="size-6" />}
            title={filtering ? 'No events match those filters' : 'No security activity yet'}
            description={
              filtering
                ? 'Widen the date range or clear a filter. Records are never deleted, so if it happened it is still here.'
                : 'Sign-ins, password changes, device revocations and checks you run all land here.'
            }
            action={
              filtering ? (
                <Button variant="secondary" onClick={reset}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{plural(events.length, 'event')} shown</Badge>
              {countOf('critical') > 0 ? <Badge tone="danger">{countOf('critical')} at critical importance</Badge> : null}
              {countOf('warning') > 0 ? <Badge tone="warn">{countOf('warning')} at warning importance</Badge> : null}
              {countOf('caution') > 0 ? <Badge tone="watch">{countOf('caution')} worth a look</Badge> : null}
            </div>
            <Card>
              <CardHeader
                title="Activity log"
                description={resource.data?.note}
                icon={<Activity className="size-4" />}
              />
              <ul className="divide-y divide-line">
                {events.map((event) => (
                  <li key={event.id} className="px-4 py-3.5 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{event.message}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <Badge tone="neutral">{CATEGORY_LABELS[event.category] ?? eventLabel(event.category)}</Badge>
                          <span className="text-xs text-faint">{eventLabel(event.eventType)}</span>
                        </div>
                        {event.metadata ? <MetadataDetails metadata={event.metadata} /> : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <SeverityBadge descriptor={severityDescriptor(event.severity)} />
                        <span className="text-xs text-faint" title={formatDateTime(event.createdAt)}>
                          {formatRelative(event.createdAt)}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="mt-5" as="div">
              <CardBody className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" aria-hidden="true" />
                <p className="text-sm text-muted">
                  This log is append-only. No screen, endpoint or database action available to you edits or removes an entry, which is
                  what makes it usable as evidence if you ever need to show what happened and when.
                </p>
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </>
  )
}
