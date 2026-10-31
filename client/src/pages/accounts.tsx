import { useMemo, useState } from 'react'
import { Boxes, CalendarClock, KeyRound, Pencil, Plus, ShieldAlert, ShieldCheck, Trash, ExternalLink } from 'lucide-react'
import { Card, CardBody, CardHeader, PageHeader } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { SelectField } from '../components/ui/field'
import { ConfirmDialog } from '../components/ui/dialog'
import { AccountFormDialog, categoryLabel, mfaLabel, type AccountFormValues } from '../components/account-form-dialog'
import { Badge, EmptyState, ErrorState, SkeletonList, Stat } from '../components/ui/feedback'
import { ApiError, api } from '../lib/api'
import type { AccountMeta, DigitalAccount } from '../lib/api-types'
import { formatDays, formatRelative, plural } from '../lib/format'
import { useResource } from '../lib/use-resource'
import { useToast } from '../state/toast'

type MessageResult = { message?: string; account?: DigitalAccount }

function ProtectionRow({ account }: { account: DigitalAccount }) {
  const flags = [
    { on: account.storedInPasswordManager, label: 'Password manager', offLabel: 'No password manager' },
    { on: account.uniquePasswordClaimed, label: 'Unique password', offLabel: 'Password reused' },
    { on: account.recoveryConfigured, label: 'Recovery set', offLabel: 'No recovery options' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {account.mfaEnabled ? (
        <Badge tone="good" Icon={ShieldCheck}>{mfaLabel(account.mfaMethod)}</Badge>
      ) : (
        <Badge tone="danger" Icon={ShieldAlert}>No second factor</Badge>
      )}
      {flags.map((flag) => (
        <Badge key={flag.label} tone={flag.on ? 'neutral' : 'watch'}>
          {flag.on ? flag.label : flag.offLabel}
        </Badge>
      ))}
      {account.reportedBreached ? <Badge tone="danger" Icon={ShieldAlert}>Reported breached</Badge> : null}
    </div>
  )
}

export function AccountsPage() {
  const { push } = useToast()
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<{ open: boolean; account: DigitalAccount | null }>({ open: false, account: null })
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingReview, setPendingReview] = useState<string | null>(null)
  const [removing, setRemoving] = useState<DigitalAccount | null>(null)

  const list = useResource<{ accounts: DigitalAccount[] }>((signal) => api.get('/api/accounts', { query: { category: category || undefined }, signal }), [category])
  const meta = useResource<AccountMeta>((signal) => api.get('/api/accounts/meta/options', { signal }), [])

  const accounts = list.data?.accounts ?? []
  const summary = useMemo(
    () => ({
      total: accounts.length,
      withMfa: accounts.filter((account) => account.mfaEnabled).length,
      needsReview: accounts.filter((account) => account.needsReview).length,
      breached: accounts.filter((account) => account.reportedBreached).length,
    }),
    [accounts],
  )

  const categoryOptions = useMemo(() => {
    const values = meta.data?.categories ?? []
    return [{ value: '', label: 'Every category' }, ...values.map((value) => ({ value, label: categoryLabel(value) }))]
  }, [meta.data])

  function fail(cause: unknown, fallback: string) {
    const message = cause instanceof ApiError ? cause.message : fallback
    setFormError(message)
    push({ tone: 'danger', title: 'Not saved', description: message })
  }

  async function saveAccount(values: AccountFormValues) {
    if (busy) return
    setBusy(true)
    setFormError(null)
    try {
      const result = editing.account
        ? await api.put<MessageResult>(`/api/accounts/${editing.account.id}`, values)
        : await api.post<MessageResult>('/api/accounts', values)
      push({ tone: 'good', title: editing.account ? 'Account updated' : 'Account added', description: result.message })
      setEditing({ open: false, account: null })
      list.reload()
    } catch (cause) {
      fail(cause, 'The account could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function logReview(account: DigitalAccount) {
    if (pendingReview) return
    setPendingReview(account.id)
    try {
      const result = await api.post<MessageResult>(`/api/accounts/${account.id}/review`)
      push({ tone: 'good', title: 'Review logged', description: result.message })
      list.reload()
    } catch (cause) {
      push({ tone: 'danger', title: 'Review not logged', description: cause instanceof ApiError ? cause.message : 'Try again.' })
    } finally {
      setPendingReview(null)
    }
  }

  async function removeAccount() {
    if (!removing || busy) return
    setBusy(true)
    try {
      const result = await api.del<MessageResult>(`/api/accounts/${removing.id}`)
      push({ tone: 'good', title: `${removing.providerName} removed`, description: result.message })
      setRemoving(null)
      list.reload()
    } catch (cause) {
      push({ tone: 'danger', title: 'Not removed', description: cause instanceof ApiError ? cause.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Digital assets"
        description="Every account you care about, with the protections it has - and never its password."
        actions={
          <Button onClick={() => { setFormError(null); setEditing({ open: true, account: null }) }}>
            <Plus className="size-4" aria-hidden="true" /> Add account
          </Button>
        }
      />

      <Card className="mb-5">
        <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Tracked" value={summary.total} tone="neutral" />
          <Stat
            label="Second factor"
            value={summary.total === 0 ? '—' : `${summary.withMfa}/${summary.total}`}
            tone={summary.total > 0 && summary.withMfa < summary.total ? 'watch' : 'good'}
            hint={summary.total === 0 ? 'Add accounts to score coverage' : 'Accounts with MFA on'}
          />
          <Stat label="Due for review" value={summary.needsReview} tone={summary.needsReview > 0 ? 'watch' : 'good'} />
          <Stat label="Flagged breached" value={summary.breached} tone={summary.breached > 0 ? 'danger' : 'good'} />
        </CardBody>
      </Card>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <SelectField
          label="Filter by category"
          value={category}
          options={categoryOptions}
          onChange={(event) => setCategory(event.target.value)}
          containerClassName="w-full max-w-xs"
        />
        <p className="text-xs text-faint">
          {list.data ? plural(summary.total, 'account') : 'Loading…'} · the score weighs coverage across all of them.
        </p>
      </div>

      {list.loading ? (
        <SkeletonList rows={4} />
      ) : list.error ? (
        <ErrorState title="Your accounts did not load" message={list.error.message} onRetry={list.reload} />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<Boxes className="size-7" />}
          title={category ? 'No accounts in this category' : 'No accounts tracked yet'}
          description={
            category
              ? 'Switch the filter back to every category, or add an account here.'
              : 'Start with the three or four accounts that matter most - your email, money, school or work, and one social account. Each one you describe makes your score more truthful.'
          }
          action={
            category ? (
              <Button variant="secondary" onClick={() => setCategory('')}>
                Show every category
              </Button>
            ) : (
              <Button onClick={() => setEditing({ open: true, account: null })}>
                <Plus className="size-4" aria-hidden="true" /> Add your first account
              </Button>
            )
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {accounts.map((account) => (
            <Card as="li" key={account.id} className="flex flex-col">
              <CardHeader
                title={account.providerName}
                description={account.usernameHint ? `Recorded as ${account.usernameHint}` : 'No username hint stored'}
                action={<Badge tone="info">{categoryLabel(account.category)}</Badge>}
              />
              <CardBody className="flex-1 space-y-3">
                <ProtectionRow account={account} />

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock className="size-3.5" aria-hidden="true" />
                    Last reviewed {account.lastReviewedAt ? formatRelative(account.lastReviewedAt) : 'never'}
                    {account.daysSinceReview !== null ? ` (${formatDays(account.daysSinceReview)})` : ''}
                  </span>
                  {account.needsReview ? <Badge tone="watch">Review due</Badge> : null}
                  {account.signInUrl ? (
                    <a
                      href={account.signInUrl}
                      target="_blank"
                      rel="noreferrer noopener nofollow"
                      className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                    >
                      Sign-in page <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>

                {account.notes ? <p className="rounded-[var(--radius-field)] bg-sunken/60 px-3 py-2 text-sm text-muted">{account.notes}</p> : null}
              </CardBody>
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pendingReview === account.id}
                  onClick={() => logReview(account)}
                  icon={<ShieldCheck className="size-3.5" aria-hidden="true" />}
                >
                  Log a review
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setFormError(null)
                    setEditing({ open: true, account })
                  }}
                  icon={<Pencil className="size-3.5" aria-hidden="true" />}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  className="ml-auto text-warn"
                  onClick={() => setRemoving(account)}
                  icon={<Trash className="size-3.5" aria-hidden="true" />}
                >
                  Remove
                </Button>
              </div>
            </Card>
          ))}
        </ul>
      )}

      <AccountFormDialog
        open={editing.open}
        account={editing.account}
        meta={meta.data ?? null}
        busy={busy}
        error={formError}
        onCancel={() => setEditing({ open: false, account: null })}
        onSubmit={saveAccount}
      />

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.providerName ?? 'this account'}?`}
        description="The record and its history go away, and your score is recalculated without it. Nothing outside Digital Guardian changes."
        confirmLabel="Remove account"
        busy={busy}
        onConfirm={removeAccount}
        onCancel={() => setRemoving(null)}
      />

      <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-faint">
        <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Digital Guardian has no field for another service&apos;s password, in this screen or anywhere in its database.
      </p>
    </>
  )
}
