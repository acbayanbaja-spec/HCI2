import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Info, RefreshCw, ShieldCheck } from 'lucide-react'
import { Card, CardBody, CardFooter, CardHeader, PageHeader } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, Badge, ErrorState, ProgressBar, SeverityBadge, Skeleton, SkeletonList } from '../components/ui/feedback'
import { ScoreMeter } from '../components/score-meter'
import { api } from '../lib/api'
import type { ScoreHistoryEntry, ScoreResponse } from '../lib/api-types'
import { formatDateTime, formatRelative, plural } from '../lib/format'
import { UNSHIPPED_NOTE, isShippedTarget } from '../lib/routes'
import { bandDescriptor, factorStatusDescriptor } from '../lib/severity'
import { useResource } from '../lib/use-resource'
import { useToast } from '../state/toast'

const TRIGGER_LABELS: Record<string, string> = {
  signup: 'Account created',
  account_created: 'Account added',
  account_updated: 'Account updated',
  review_logged: 'Review logged',
  checklist_updated: 'Checklist changed',
  learning_completed: 'Lesson completed',
  recommendation_updated: 'Advice actioned',
  incident_updated: 'Incident changed',
  alerts_reviewed: 'Alerts reviewed',
  analysis_run: 'Link or message checked',
  mfa_updated: 'Two-step verification changed',
  manual: 'Recalculated by you',
  periodic: 'Automatic re-check',
}

function triggerLabel(trigger: string): string {
  return TRIGGER_LABELS[trigger] ?? trigger.replace(/_/g, ' ')
}

export function ScorePage() {
  const { push } = useToast()
  const [busy, setBusy] = useState(false)
  const score = useResource<ScoreResponse>((signal) => api.get('/api/score', { signal }), [])
  const history = useResource<{ history: ScoreHistoryEntry[] }>((signal) => api.get('/api/score/history', { query: { limit: 12 }, signal }), [])

  async function recalculate() {
    if (busy) return
    setBusy(true)
    try {
      const next = await api.post<ScoreResponse>('/api/score/recalculate')
      score.replace(next)
      history.reload()
      push({ tone: 'good', title: `Score recalculated: ${next.score}/100`, description: 'Nothing was invented - the factors show what changed.' })
    } catch (error) {
      push({ tone: 'danger', title: 'Could not recalculate', description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const applicable = score.data?.factors.filter((factor) => factor.status !== 'not_applicable') ?? []
  const skipped = score.data?.factors.length ?? 0

  return (
    <>
      <PageHeader
        title="Your Digital Safety Score"
        description="The number, the weights behind it, and the plain-language reason for each part."
        actions={
          <Button onClick={recalculate} loading={busy} variant="secondary">
            <RefreshCw className="size-4" aria-hidden="true" /> Recalculate
          </Button>
        }
      />

      {score.loading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-[var(--radius-card)]" />
          <SkeletonList rows={4} />
        </div>
      ) : score.error ? (
        <ErrorState title="The score could not be loaded" message={score.error.message} onRetry={score.reload} />
      ) : score.data ? (
        <div className="space-y-5">
          <Card>
            <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <ScoreMeter score={score.data.score} band={score.data.band} size={160} />
              <div className="min-w-0 flex-1 sm:max-w-lg">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge descriptor={bandDescriptor(score.data.band)} large />
                  {score.data.attentionCount > 0 ? (
                    <Badge tone="watch">{plural(score.data.attentionCount, 'factor')} not fully covered</Badge>
                  ) : null}
                </div>
                <h2 className="mt-3 text-lg font-semibold text-ink">{score.data.headline}</h2>
                <p className="mt-1.5 text-sm text-muted">
                  Calculated {formatRelative(score.data.computedAt)} · model version {score.data.modelVersion}
                </p>
              </div>
            </CardBody>
            <CardFooter className="flex-col items-start gap-2 sm:flex-row sm:items-center">
              <p className="text-xs text-faint">
                {plural(applicable.length, 'factor')} counted · {skipped - applicable.length} marked “does not apply” were left out
                instead of scored.
              </p>
              <Link to="/recommendations" className="text-xs font-semibold text-brand hover:underline">
                Turn the gaps into actions
              </Link>
            </CardFooter>
          </Card>

          <Alert tone="info" title="How this number is built" Icon={Info}>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {score.data.howItWorks.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Alert>

          <Card>
            <CardHeader title="Every factor, with its reason" description="Weight is what the factor can earn at most. Earned is what you have." icon={<ShieldCheck className="size-4" />} />
            <ul className="divide-y divide-line">
              {score.data.factors.map((factor) => {
                const status = factorStatusDescriptor(factor.status)
                const ratio = factor.weight > 0 ? (factor.earned / factor.weight) * 100 : 0
                return (
                  <li key={factor.key} className="px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{factor.label}</p>
                        <p className="mt-1 max-w-2xl text-sm text-muted">{factor.reason}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        <span className="text-sm font-semibold tabular-nums text-ink">
                          {factor.earned}
                          <span className="text-faint">/{factor.weight}</span>
                        </span>
                      </div>
                    </div>

                    <ProgressBar
                      value={factor.status === 'not_applicable' ? 0 : ratio}
                      tone={status.tone}
                      label={`${factor.label}: ${factor.earned} of ${factor.weight} possible points`}
                      className="mt-3"
                    />

                    {factor.actionHref ? (
                      isShippedTarget(factor.actionHref) ? (
                        <Link to={factor.actionHref} className="mt-2.5 inline-block text-sm font-semibold text-brand hover:underline">
                          Fix this
                        </Link>
                      ) : (
                        <p className="mt-2.5 text-xs text-faint">{UNSHIPPED_NOTE}</p>
                      )
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Score history" description="Only real recalculations, each labelled with what caused it." icon={<Activity className="size-4" />} />
            <CardBody className="p-0">
              {history.loading ? (
                <div className="px-4 sm:px-5">
                  <SkeletonList rows={3} />
                </div>
              ) : history.error ? (
                <div className="px-4 sm:px-5">
                  <ErrorState message={history.error.message} onRetry={history.reload} title="History did not load" />
                </div>
              ) : !history.data || history.data.history.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted sm:px-5">No recalculations recorded yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {history.data.history.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{triggerLabel(entry.trigger)}</p>
                        <p className="text-xs text-faint" title={formatDateTime(entry.createdAt)}>
                          {formatRelative(entry.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <SeverityBadge descriptor={bandDescriptor(entry.band as ScoreResponse['band'])} />
                        <span className="text-sm font-semibold tabular-nums text-ink">{entry.score}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <p className="text-xs leading-relaxed text-faint">
            A factor marked “not applicable” is removed from the maths and the remaining weights are scaled back up to 100, so
            refusing to use a feature is never punished as though it were a hole in your security. Severity is always shown with an
            icon and a word, never as colour alone.
          </p>
        </div>
      ) : null}
    </>
  )
}
