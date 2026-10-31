import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, BellRing, CheckCheck, ExternalLink, Inbox } from 'lucide-react'
import { Card, CardBody, CardHeader, PageHeader } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge, EmptyState, ErrorState, SeverityBadge, SkeletonList } from '../components/ui/feedback'
import { SelectField } from '../components/ui/field'
import { api } from '../lib/api'
import type { NotificationItem, NotificationKind } from '../lib/api-types'
import { notifyAlertsChanged } from '../lib/alert-bus'
import { formatDateTime, formatRelative, plural } from '../lib/format'
import { isShippedTarget } from '../lib/routes'
import { severityDescriptor } from '../lib/severity'
import { useResource } from '../lib/use-resource'
import { useToast } from '../state/toast'

type Filter = 'all' | 'unread' | 'read' | 'archived'

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'unread', label: 'Unread' },
  { value: 'read', label: 'Read' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'Everything' },
]

const KIND_LABELS: Record<NotificationKind, string> = {
  security_alert: 'Security alert',
  recommendation: 'Advice',
  report_update: 'Your report',
  learning: 'Learning',
  emergency: 'Emergency response',
  system: 'System',
}

const KIND_OPTIONS = [
  { value: '', label: 'All types' },
  ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
]

type NotificationsResponse = { notifications: NotificationItem[]; unread: number }

export function AlertsPage() {
  const { push } = useToast()
  const [filter, setFilter] = useState<Filter>('unread')
  const [kind, setKind] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  const resource = useResource<NotificationsResponse>(
    (signal) => api.get('/api/notifications', { query: { filter, kind, limit: 100 }, signal }),
    [filter, kind],
  )

  async function act(notification: NotificationItem, action: 'read' | 'archive') {
    if (busyId) return
    setBusyId(notification.id)
    try {
      const result = await api.post<{ score: { score: number } }>(`/api/notifications/${notification.id}/${action}`)
      resource.reload()
      notifyAlertsChanged()
      push({ tone: 'good', title: action === 'read' ? 'Marked as read' : 'Archived', description: `Your score is now ${result.score.score}/100.` })
    } catch (error) {
      push({ tone: 'danger', title: `Could not ${action}`, description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setBusyId(null)
    }
  }

  async function markAllRead() {
    if (clearing) return
    setClearing(true)
    try {
      const result = await api.post<{ marked: number; score: { score: number } }>('/api/notifications/read-all')
      resource.reload()
      notifyAlertsChanged()
      push({
        tone: 'good',
        title: result.marked === 0 ? 'Nothing was unread' : `${plural(result.marked, 'alert')} marked as read`,
        description: `Your score is now ${result.score.score}/100.`,
      })
    } catch (error) {
      push({ tone: 'danger', title: 'Could not update your alerts', description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setClearing(false)
    }
  }

  const items = resource.data?.notifications ?? []
  const unread = resource.data?.unread ?? 0

  return (
    <>
      <PageHeader
        title="Alerts"
        description="What Digital Guardian told you, and when. Security alerts are always delivered; the rest you can switch off in settings."
        actions={
          <Button variant="secondary" onClick={markAllRead} loading={clearing} disabled={unread === 0}>
            <CheckCheck className="size-4" aria-hidden="true" /> Mark all as read
          </Button>
        }
      />

      <Card className="mt-5" as="div">
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div role="tablist" aria-label="Alert state" className="flex flex-wrap gap-2">
            {FILTERS.map((entry) => (
              <Button
                key={entry.value}
                size="sm"
                variant={filter === entry.value ? 'primary' : 'ghost'}
                role="tab"
                aria-selected={filter === entry.value}
                onClick={() => setFilter(entry.value)}
              >
                {entry.label}
                {entry.value === 'unread' && unread > 0 ? <Badge tone="watch">{unread}</Badge> : null}
              </Button>
            ))}
          </div>
          <SelectField
            label="Type"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            options={KIND_OPTIONS}
            containerClassName="sm:w-56"
          />
        </CardBody>
      </Card>

      <div className="mt-5">
        {resource.loading ? (
          <SkeletonList rows={4} />
        ) : resource.error ? (
          <ErrorState title="Your alerts did not load" message={resource.error.message} onRetry={resource.reload} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-6" />}
            title={filter === 'unread' ? 'No unread alerts' : 'Nothing in this view'}
            description={
              filter === 'unread'
                ? 'When something about your account changes in a way that matters, it appears here.'
                : 'Try a different state or type. Archived alerts stay available, they just leave the unread list.'
            }
            action={
              <Link to="/settings/notifications" className="text-sm font-semibold text-brand hover:underline">
                Choose what alerts you receive
              </Link>
            }
          />
        ) : (
          <Card>
            <CardHeader
              title={`${plural(items.length, 'alert')} in this view`}
              description="Newest first. Unread alerts are marked with a dot and a word, not colour alone."
              icon={<BellRing className="size-4" />}
            />
            <ul className="divide-y divide-line">
              {items.map((item) => {
                const busy = busyId === item.id
                return (
                  <li key={item.id} className={item.read ? 'px-4 py-4 sm:px-5' : 'bg-brand-soft/40 px-4 py-4 sm:px-5'}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {!item.read ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                              <span aria-hidden="true" className="size-2 rounded-full bg-brand" />
                              Unread
                            </span>
                          ) : null}
                          <SeverityBadge descriptor={severityDescriptor(item.severity)} />
                          <Badge tone="neutral">{KIND_LABELS[item.kind] ?? item.kind}</Badge>
                          {item.archived ? <Badge tone="neutral">Archived</Badge> : null}
                        </div>
                        <h3 className="mt-2 text-sm font-semibold text-ink">{item.title}</h3>
                        <p className="mt-1 max-w-2xl text-sm text-muted">{item.body}</p>
                        <p className="mt-1.5 text-xs text-faint" title={formatDateTime(item.createdAt)}>
                          {formatRelative(item.createdAt)}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {item.link && isShippedTarget(item.link) ? (
                          <Link to={item.link}>
                            <Button size="sm" variant="secondary">
                              <ExternalLink className="size-4" aria-hidden="true" /> Open
                            </Button>
                          </Link>
                        ) : item.link ? (
                          <span className="text-xs text-faint">Screen opens in a later release.</span>
                        ) : null}
                        {!item.read ? (
                          <Button size="sm" variant="ghost" loading={busy} onClick={() => act(item, 'read')} aria-label={`Mark “${item.title}” as read`}>
                            <CheckCheck className="size-4" aria-hidden="true" /> Read
                          </Button>
                        ) : null}
                        {!item.archived ? (
                          <Button size="sm" variant="quiet" disabled={busy} onClick={() => act(item, 'archive')} aria-label={`Archive “${item.title}”`}>
                            <Archive className="size-4" aria-hidden="true" /> Archive
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-faint">
        Archiving keeps an alert in your history — it never deletes it. Security alerts cannot be silenced completely: switching
        them off in settings only stops non-security reminders.
      </p>
    </>
  )
}
