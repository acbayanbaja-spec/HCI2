import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, CheckCheck, EyeOff, ListChecks, RotateCcw } from 'lucide-react'
import { Card, CardBody, CardHeader, PageHeader } from '../components/ui/card'
import { Alert, Badge, EmptyState, ErrorState, SeverityBadge, SkeletonList } from '../components/ui/feedback'
import { Button } from '../components/ui/button'
import { api } from '../lib/api'
import type { Recommendation, RecommendationCategory, RecommendationStatus } from '../lib/api-types'
import { formatRelative, plural } from '../lib/format'
import { UNSHIPPED_NOTE, isShippedTarget } from '../lib/routes'
import { priorityDescriptor } from '../lib/severity'
import { useResource } from '../lib/use-resource'
import { useToast } from '../state/toast'

const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  authentication: 'Signing in',
  accounts: 'Your accounts',
  recovery: 'Getting back in',
  alerts: 'Alerts and notifications',
  learning: 'Learning',
  privacy: 'Privacy',
  incidents: 'Incidents',
  sessions: 'Devices and sessions',
}

const TABS: Array<{ status: RecommendationStatus; label: string }> = [
  { status: 'open', label: 'Worth doing' },
  { status: 'completed', label: 'Done' },
  { status: 'dismissed', label: 'Put away' },
]

const EMPTY_COPY: Record<RecommendationStatus, { title: string; message: string }> = {
  open: {
    title: 'Nothing is waiting for you',
    message: 'The engine looked at your account and found no gap it can prove. It checks again whenever something changes.',
  },
  completed: {
    title: 'No completed actions yet',
    message: 'When you mark something as done it stays here, and your score is recalculated from the real change.',
  },
  dismissed: {
    title: 'Nothing is put away',
    message: 'Dismissed advice returns by itself if the reason that produced it becomes true again.',
  },
}

const CATEGORY_ORDER: RecommendationCategory[] = [
  'authentication',
  'recovery',
  'sessions',
  'accounts',
  'alerts',
  'privacy',
  'incidents',
  'learning',
]

function groupByCategory(items: Recommendation[]): Array<[RecommendationCategory, Recommendation[]]> {
  const byCategory = new Map<RecommendationCategory, Recommendation[]>()
  for (const item of items) {
    const list = byCategory.get(item.category)
    if (list) list.push(item)
    else byCategory.set(item.category, [item])
  }
  return [...byCategory.entries()].sort((a, b) => {
    const rankA = CATEGORY_ORDER.indexOf(a[0])
    const rankB = CATEGORY_ORDER.indexOf(b[0])
    if (rankA !== rankB) return (rankA < 0 ? 99 : rankA) - (rankB < 0 ? 99 : rankB)
    return a[0].localeCompare(b[0])
  })
}

export function RecommendationsPage() {
  const { push } = useToast()
  const [tab, setTab] = useState<RecommendationStatus>('open')
  const [busyId, setBusyId] = useState<string | null>(null)

  const list = useResource<{ recommendations: Recommendation[] }>(
    (signal) => api.get('/api/recommendations', { query: { status: tab }, signal }),
    [tab],
  )

  async function setStatus(recommendation: Recommendation, status: RecommendationStatus) {
    if (busyId) return
    setBusyId(recommendation.id)
    try {
      const result = await api.patch<{ recommendation: Recommendation; message: string }>(`/api/recommendations/${recommendation.id}`, {
        status,
      })
      list.reload()
      push({ tone: status === 'completed' ? 'good' : 'info', title: result.message })
    } catch (error) {
      push({ tone: 'danger', title: 'That action did not stick', description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setBusyId(null)
    }
  }

  const emptyCopy = EMPTY_COPY[tab]
  const items = list.data?.recommendations ?? []
  const possibleWeight = tab === 'open' ? items.reduce((sum, item) => sum + item.weight, 0) : 0

  return (
    <>
      <PageHeader
        title="Advice made for your account"
        description="Generated from what your account actually shows, ordered by how much each one is worth."
      />

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Advice status">
        {TABS.map((entry) => (
          <Button
            key={entry.status}
            variant={tab === entry.status ? 'primary' : 'secondary'}
            size="sm"
            role="tab"
            aria-selected={tab === entry.status}
            onClick={() => setTab(entry.status)}
          >
            {entry.label}
          </Button>
        ))}
        {!list.loading && !list.error && items.length > 0 ? (
          <span className="text-sm text-muted">{plural(items.length, 'item')}</span>
        ) : null}
      </div>

      {tab === 'open' && possibleWeight > 0 ? (
        <Alert className="mt-4" tone="info" title="What this is worth">
          <p className="text-sm">
            Finishing everything here is worth up to <strong className="font-semibold text-ink">{possibleWeight} points</strong> of
            your 100-point score. The engine will not promise more than the weights allow, and it drops an item once the reason
            for it is no longer true.
          </p>
        </Alert>
      ) : null}

      <div className="mt-5">
        {list.loading ? (
          <SkeletonList rows={4} />
        ) : list.error ? (
          <ErrorState title="Your advice could not be loaded" message={list.error.message} onRetry={list.reload} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<CheckCheck className="size-6" />}
            title={emptyCopy.title}
            description={emptyCopy.message}
            action={
              <Link to="/score" className="text-sm font-semibold text-brand hover:underline">
                See the score it came from
              </Link>
            }
          />
        ) : (
          <div className="space-y-5">
            {groupByCategory(items).map(([category, group]) => (
              <Card key={category}>
                <CardHeader
                  title={CATEGORY_LABELS[category] ?? category}
                  description={`${plural(group.length, 'suggestion')} in this area`}
                  icon={<ListChecks className="size-4" />}
                />
                <ul className="divide-y divide-line">
                  {group.map((item) => {
                    const priority = priorityDescriptor(item.priority)
                    const busy = busyId === item.id
                    return (
                      <li key={item.id} className="animate-rise px-4 py-4 sm:px-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <SeverityBadge descriptor={priority} />
                              <span className="text-xs text-faint">worth {plural(item.weight, 'point')}</span>
                            </div>
                            <h3 className="mt-2 text-sm font-semibold text-ink">{item.title}</h3>
                            <p className="mt-1 max-w-2xl text-sm text-muted">{item.detail}</p>
                            <p className="mt-2 max-w-2xl border-l-2 border-line-strong pl-3 text-xs text-faint">
                              Why you are seeing this: {item.reason}
                            </p>
                          </div>
                          <p className="shrink-0 text-xs text-faint" title={formatRelative(item.firstSeenAt)}>
                            since {formatRelative(item.firstSeenAt)}
                          </p>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {item.status === 'open' ? (
                            <>
                              {isShippedTarget(item.actionHref) ? (
                                <Link to={item.actionHref}>
                                  <Button size="sm">{item.actionLabel}</Button>
                                </Link>
                              ) : (
                                <span className="text-xs text-faint">{UNSHIPPED_NOTE}</span>
                              )}
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={busy}
                                onClick={() => setStatus(item, 'completed')}
                                aria-label={`Mark “${item.title}” as done`}
                              >
                                <CheckCheck className="size-4" aria-hidden="true" /> Mark as done
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => setStatus(item, 'dismissed')}
                                aria-label={`Put away “${item.title}”`}
                              >
                                <EyeOff className="size-4" aria-hidden="true" /> Put away
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" variant="secondary" loading={busy} onClick={() => setStatus(item, 'open')}>
                              <RotateCcw className="size-4" aria-hidden="true" /> Reopen
                            </Button>
                          )}
                          {item.learnHref && isShippedTarget(item.learnHref) ? (
                            <Link to={item.learnHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
                              <BookOpen className="size-4" aria-hidden="true" /> Learn about this
                            </Link>
                          ) : null}
                          {item.completedAt ? <Badge tone="good">done {formatRelative(item.completedAt)}</Badge> : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            ))}

            <Card as="div">
              <CardBody>
                <h2 className="text-sm font-semibold text-ink">How this list is made</h2>
                <p className="mt-1.5 text-sm text-muted">
                  Each suggestion is produced by the same signals that calculate your score, so the advice and the number can never
                  disagree. Nothing here is a generic tip: an item only appears when your own account data shows the gap, and it
                  disappears when you close it. Priority and worth come from the factor weight, not from a guess.
                </p>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </>
  )
}
