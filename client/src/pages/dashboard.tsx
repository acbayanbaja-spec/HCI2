import { Link } from 'react-router-dom'
import { Activity, ArrowUpRight, Bell, Boxes, CircleCheck, ScanSearch, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Card, CardBody, CardFooter, CardHeader, PageHeader } from '../components/ui/card'
import { Alert, EmptyState, ErrorState, SeverityBadge, Skeleton, SkeletonList, Stat } from '../components/ui/feedback'
import { ScoreMeter } from '../components/score-meter'
import { buttonClasses } from '../components/ui/button'
import { api } from '../lib/api'
import type { Dashboard } from '../lib/api-types'
import { cn } from '../lib/cn'
import { formatDateTime, formatRelative, plural } from '../lib/format'
import { UNSHIPPED_NOTE, isShippedTarget } from '../lib/routes'
import { TONE_CLASSES, priorityDescriptor, severityDescriptor, verdictDescriptor } from '../lib/severity'
import { useResource } from '../lib/use-resource'
import { useAuth } from '../state/auth'

function SignalRow({ ok, label, detail, href }: { ok: boolean; label: string; detail: string; href?: string }) {
  const body = (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className={cn('mt-0.5 shrink-0', ok ? 'text-good' : 'text-watch')} aria-hidden="true">
        {ok ? <CircleCheck className="size-4" /> : <TriangleAlert className="size-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
      {href ? <ArrowUpRight className="ml-auto size-4 shrink-0 text-faint" aria-hidden="true" /> : null}
    </div>
  )
  return href ? (
    <Link to={href} className="block rounded-md transition hover:bg-sunken">
      {body}
    </Link>
  ) : (
    body
  )
}

export function DashboardPage() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useResource<Dashboard>((signal) => api.get('/api/dashboard', { signal }), [])

  return (
    <>
      <PageHeader
        title={user ? `Hello, ${user.displayName}` : 'Your safety overview'}
        description="One view of what Digital Guardian can actually see about your account, and what to do next."
        actions={
          <Link to="/check-link" className={buttonClasses('primary', 'md')}>
            <ScanSearch className="size-4" aria-hidden="true" /> Check a link
          </Link>
        }
      />

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-[var(--radius-card)]" />
          <SkeletonList rows={3} />
        </div>
      ) : error ? (
        <ErrorState message={error.message} onRetry={reload} title="Your dashboard could not be loaded" />
      ) : data ? (
        <div className="space-y-5">
          <Card aria-label="Digital Safety Score">
            <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <ScoreMeter score={data.score.score} band={data.score.band} />
              <div className="min-w-0 flex-1 sm:max-w-md">
                <h2 className="text-lg font-semibold text-ink">{data.score.headline}</h2>
                <p className="mt-1.5 text-sm text-muted">
                  Calculated {formatRelative(data.score.computedAt)} from {plural(data.score.factors.length, 'weighted factor')}{' '}
                  about your account.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link to="/score" className={buttonClasses('secondary', 'sm')}>
                    See how the score is built
                  </Link>
                  {data.score.attentionCount > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-watch">
                      <TriangleAlert className="size-4" aria-hidden="true" />
                      {plural(data.score.attentionCount, 'factor')} need{data.score.attentionCount === 1 ? 's' : ''} attention
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-good">
                      <ShieldCheck className="size-4" aria-hidden="true" /> Nothing urgent
                    </span>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
            <Card>
              <CardHeader
                title="Your next moves"
                description="Ordered by how much protection each one adds."
                icon={<ShieldCheck className="size-4" />}
                action={
                  <Link to="/recommendations" className={buttonClasses('ghost', 'sm')}>
                    All advice
                  </Link>
                }
              />
              <CardBody className="p-0">
                {data.priorityActions.length === 0 ? (
                  <div className="px-4 py-6 sm:px-5">
                    <EmptyState
                      icon={<CircleCheck className="size-6" />}
                      title="Nothing is asking for your attention"
                      description="Every condition that generated advice is now false. New advice appears as soon as something changes."
                    />
                  </div>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.priorityActions.map((item) => {
                      const descriptor = priorityDescriptor(item.priority)
                      return (
                        <li key={item.id} className="px-4 py-3.5 sm:px-5">
                          <div className="flex flex-wrap items-start gap-3">
                            <SeverityBadge descriptor={descriptor} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-ink">{item.title}</p>
                              <p className="mt-1 text-sm text-muted">{item.detail}</p>
                            </div>
                            {isShippedTarget(item.actionHref) ? (
                              <Link to={item.actionHref} className={cn(buttonClasses('secondary', 'sm'), 'shrink-0')}>
                                {item.actionLabel}
                              </Link>
                            ) : (
                              <span className="shrink-0 max-w-[14rem] text-right text-xs text-faint">{UNSHIPPED_NOTE}</span>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>

            <div className="space-y-5">
              <Card>
                <CardHeader title="Your accounts" icon={<Boxes className="size-4" />} action={<Link to="/accounts" className={buttonClasses('ghost', 'sm')}>Manage</Link>} />
                <CardBody>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Tracked" value={data.accounts.total} tone={data.accounts.total === 0 ? 'watch' : 'neutral'} />
                    <Stat label="With MFA" value={`${data.accounts.withMfa}/${data.accounts.total || 0}`} tone={data.accounts.total > 0 && data.accounts.withMfa < data.accounts.total ? 'watch' : 'good'} />
                    <Stat label="Due review" value={data.accounts.needsReview} tone={data.accounts.needsReview > 0 ? 'watch' : 'good'} />
                    <Stat label="Reported breached" value={data.accounts.reportedBreached} tone={data.accounts.reportedBreached > 0 ? 'danger' : 'good'} />
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-faint">
                    Digital Guardian records what you tell it about each account - never a password for it.
                  </p>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Latest check" icon={<ScanSearch className="size-4" />} action={<Link to="/check-link" className={buttonClasses('ghost', 'sm')}>New check</Link>} />
                <CardBody>
                  {data.latestCheck ? (
                    <Link to="/check-link" className="block rounded-[var(--radius-field)] border border-line px-3.5 py-3 transition hover:bg-sunken">
                      <SeverityBadge descriptor={verdictDescriptor(data.latestCheck.verdict)} />
                      <p className="mt-2 line-clamp-2 text-sm text-ink">{data.latestCheck.inputExcerpt}</p>
                      <p className="mt-1 text-xs text-faint">
                        Risk {data.latestCheck.riskScore}/100 · {formatRelative(data.latestCheck.createdAt)}
                      </p>
                    </Link>
                  ) : (
                    <EmptyState
                      icon={<ScanSearch className="size-6" />}
                      title="No checks yet"
                      description="Paste a link or message you are unsure about and read why it scores the way it does."
                      action={
                        <Link to="/check-link" className={buttonClasses('primary', 'sm')}>
                          Check something now
                        </Link>
                      }
                      className="border-0 bg-transparent px-0 py-2"
                    />
                  )}
                </CardBody>
              </Card>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Alerts"
                description={data.unreadAlerts > 0 ? `${plural(data.unreadAlerts, 'unread alert')}` : 'Nothing unread.'}
                icon={<Bell className="size-4" />}
                action={<Link to="/alerts" className={buttonClasses('ghost', 'sm')}>Open alerts</Link>}
              />
              <CardBody className="p-0">
                {data.alerts.length === 0 ? (
                  <div className="px-4 py-6 sm:px-5">
                    <EmptyState
                      icon={<CircleCheck className="size-6" />}
                      title="No unread security alerts"
                      description="Alerts about sign-ins, checks and reports land here as they happen."
                    />
                  </div>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.alerts.map((alert) => {
                      const descriptor = severityDescriptor(alert.severity)
                      return (
                        <li key={alert.id} className="px-4 py-3 sm:px-5">
                          <div className="flex items-start gap-3">
                            <span className={cn('mt-0.5 shrink-0', descriptor.tone === 'danger' || descriptor.tone === 'warn' ? 'text-warn' : 'text-info')}>
                              <descriptor.Icon className="size-4" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-ink">{alert.title}</p>
                              <p className="mt-0.5 text-sm text-muted">{alert.body}</p>
                              <p className="mt-1 text-xs text-faint">{formatRelative(alert.createdAt)}</p>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardBody>
              <CardFooter>
                <p className="text-xs text-faint">Alert text is written by the same rules as the score: no invented findings.</p>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader title="Recent activity" icon={<Activity className="size-4" />} action={<Link to="/activity" className={buttonClasses('ghost', 'sm')}>Full history</Link>} />
              <CardBody className="p-0">
                {data.recentActivity.length === 0 ? (
                  <div className="px-4 py-6 sm:px-5">
                    <EmptyState icon={<Activity className="size-6" />} title="No recorded activity yet" description="Sign-ins, checks and settings changes are logged here from your first action." />
                  </div>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.recentActivity.map((event) => (
                      <li key={event.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                        <span className={cn('mt-0.5 shrink-0', event.severity === 'info' ? 'text-faint' : TONE_CLASSES[severityDescriptor(event.severity).tone].text)}>
                          <Activity className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm text-ink">{event.message}</p>
                          <p className="mt-0.5 text-xs text-faint" title={formatDateTime(event.createdAt)}>
                            {formatRelative(event.createdAt)} · {event.category.replace(/_/g, ' ')}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="The basics" description="What Digital Guardian knows about this account itself." icon={<ShieldCheck className="size-4" />} />
            <CardBody className="grid gap-x-6 sm:grid-cols-2">
              <SignalRow ok={data.signals.mfaEnabled} label="Two-step verification" detail={data.signals.mfaEnabled ? 'Your sign-in needs a second factor.' : 'Off - your password is the only gate.'} href={data.signals.mfaEnabled ? undefined : '/settings/security'} />
              <SignalRow ok={data.signals.emailVerified} label="Email confirmed" detail={data.signals.emailVerified ? 'This address was verified.' : 'Confirm the address to prove recovery is possible.'} href={data.signals.emailVerified ? undefined : '/settings/profile'} />
              <SignalRow ok={data.signals.hasRecoveryEmail} label="Recovery address" detail={data.signals.hasRecoveryEmail ? 'A second address is on file.' : 'Add one so a lost password is not a lost account.'} href={data.signals.hasRecoveryEmail ? undefined : '/settings/profile'} />
              <SignalRow
                ok={data.signals.checklistDone === data.signals.checklistTotal}
                label="Privacy checklist"
                detail={`${data.signals.checklistDone} of ${data.signals.checklistTotal} items done. The privacy centre opens in the next release.`}
              />
              <SignalRow
                ok={data.signals.lessonsCompleted > 0}
                label="Learning"
                detail={`${data.signals.lessonsCompleted} of ${data.signals.lessonsTotal} lessons completed. The hub arrives with the next release.`}
              />
              <SignalRow
                ok={data.signals.openIncidents === 0}
                label="Open incidents"
                detail={data.signals.openIncidents === 0 ? 'Nothing is open.' : `${plural(data.signals.openIncidents, 'incident')} still open.`}
              />
            </CardBody>
          </Card>

          {data.activeSessions > 1 ? (
            <Alert tone="watch" title={`${plural(data.activeSessions, 'active session')} on this account`} Icon={ShieldCheck}>
              <p className="text-sm">
                If you do not recognise one of them, sign the others out from{' '}
                <Link to="/settings/security" className="font-semibold text-ink underline">
                  Settings → Security &amp; devices
                </Link>
                .
              </p>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
