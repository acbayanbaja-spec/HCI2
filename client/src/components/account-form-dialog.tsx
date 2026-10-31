import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { LockKeyhole, ShieldCheck } from 'lucide-react'
import { Dialog, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'
import { Alert, Badge } from './ui/feedback'
import { SelectField, TextArea, TextField } from './ui/field'
import type { AccountCategory, AccountInput, AccountMeta, DigitalAccount } from '../lib/api-types'

const CATEGORY_LABELS: Record<string, string> = {
  email: 'Email',
  social: 'Social media',
  school: 'School',
  work: 'Work',
  finance: 'Money',
  shopping: 'Shopping',
  health: 'Health',
  government: 'Government',
  entertainment: 'Entertainment',
  developer: 'Developer tools',
  other: 'Other',
}

const MFA_LABELS: Record<string, string> = {
  none: 'No second factor',
  authenticator_app: 'Authenticator app',
  sms: 'Text message (SMS)',
  security_key: 'Security key',
  passkey: 'Passkey',
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

export function mfaLabel(method: string): string {
  return MFA_LABELS[method] ?? method
}

type Draft = {
  providerName: string
  category: AccountCategory
  usernameHint: string
  signInUrl: string
  mfaEnabled: boolean
  mfaMethod: string
  storedInPasswordManager: boolean
  uniquePasswordClaimed: boolean
  recoveryConfigured: boolean
  reportedBreached: boolean
  reviewIntervalDays: number
  notes: string
}

const EMPTY: Draft = {
  providerName: '',
  category: 'email',
  usernameHint: '',
  signInUrl: '',
  mfaEnabled: false,
  mfaMethod: 'none',
  storedInPasswordManager: false,
  uniquePasswordClaimed: false,
  recoveryConfigured: false,
  reportedBreached: false,
  reviewIntervalDays: 90,
  notes: '',
}

function fromAccount(account: DigitalAccount): Draft {
  return {
    providerName: account.providerName,
    category: account.category,
    usernameHint: account.usernameHint ?? '',
    signInUrl: account.signInUrl ?? '',
    mfaEnabled: account.mfaEnabled,
    mfaMethod: account.mfaMethod,
    storedInPasswordManager: account.storedInPasswordManager,
    uniquePasswordClaimed: account.uniquePasswordClaimed,
    recoveryConfigured: account.recoveryConfigured,
    reportedBreached: account.reportedBreached,
    reviewIntervalDays: account.reviewIntervalDays,
    notes: account.notes ?? '',
  }
}

export type AccountFormValues = Omit<AccountInput, 'usernameHint' | 'signInUrl' | 'notes'> & {
  usernameHint: string | null
  signInUrl: string | null
  notes: string | null
}

function CheckRow({
  checked,
  onChange,
  label,
  description,
  tone,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description: string
  tone?: 'danger' | 'neutral'
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-2.5 rounded-[var(--radius-field)] border border-line px-3 py-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
        aria-describedby={`${id}-description`}
      />
      <label htmlFor={id} className="min-w-0 cursor-pointer text-sm">
        <span className={tone === 'danger' ? 'font-medium text-warn' : 'font-medium text-ink'}>{label}</span>
        <span id={`${id}-description`} className="mt-0.5 block text-xs text-muted">
          {description}
        </span>
      </label>
    </div>
  )
}

/**
 * The only form in the product that describes another service - and it has no
 * password field, because Digital Guardian never wants one.
 */
export function AccountFormDialog({
  open,
  account,
  meta,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  open: boolean
  account: DigitalAccount | null
  meta: AccountMeta | null
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (values: AccountFormValues) => void
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) {
      setDraft(account ? fromAccount(account) : EMPTY)
      setErrors({})
    }
  }, [open, account])

  const categories = useMemo(
    () => (meta?.categories ?? Object.keys(CATEGORY_LABELS)).map((value) => ({ value, label: categoryLabel(value) })),
    [meta],
  )
  const mfaMethods = useMemo(
    () => (meta?.mfaMethods ?? Object.keys(MFA_LABELS)).map((value) => ({ value, label: mfaLabel(value) })),
    [meta],
  )

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (draft.providerName.trim().length === 0) next.providerName = 'Name the account, for example "Gmail".'
    if (draft.signInUrl && !/^https?:\/\/.+\..+/i.test(draft.signInUrl.trim())) next.signInUrl = 'That does not look like a web address.'
    if (draft.reviewIntervalDays < 7 || draft.reviewIntervalDays > 365) next.reviewIntervalDays = 'Choose between 7 and 365 days.'
    if (draft.mfaEnabled && draft.mfaMethod === 'none') next.mfaMethod = 'Say how two-step verification works there, or switch it off.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    onSubmit({
      providerName: draft.providerName.trim(),
      category: draft.category,
      usernameHint: draft.usernameHint.trim() || null,
      signInUrl: draft.signInUrl.trim() || null,
      mfaEnabled: draft.mfaEnabled,
      mfaMethod: draft.mfaMethod as AccountFormValues['mfaMethod'],
      storedInPasswordManager: draft.storedInPasswordManager,
      uniquePasswordClaimed: draft.uniquePasswordClaimed,
      recoveryConfigured: draft.recoveryConfigured,
      reportedBreached: draft.reportedBreached,
      reviewIntervalDays: draft.reviewIntervalDays,
      notes: draft.notes.trim() || null,
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      size="lg"
      title={account ? `Edit ${account.providerName}` : 'Add an account'}
      description="What you can say about this account without ever writing down its password."
      footer={
        <DialogFooter
          cancel={onCancel}
          confirm={
            <Button type="submit" form="account-form" loading={busy}>
              {account ? 'Save changes' : 'Add account'}
            </Button>
          }
        />
      }
    >
      <form id="account-form" onSubmit={submit} className="space-y-4" noValidate>
        {error ? <Alert tone="danger" title="Not saved" Icon={ShieldCheck}>{error}</Alert> : null}

        <Alert tone="info" title="No password here, on purpose" Icon={LockKeyhole}>
          <p className="text-sm">
            A masked hint like “ends in @mail.ph” is the most this form accepts. If a screen ever asks for the password of another
            service, that is the scam.
          </p>
        </Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Service or provider"
            value={draft.providerName}
            error={errors.providerName}
            onChange={(event) => set('providerName', event.target.value)}
            placeholder="Gmail"
            required
          />
          <SelectField
            label="What kind of account"
            value={draft.category}
            options={categories}
            onChange={(event) => set('category', event.target.value as AccountCategory)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Username hint (optional)"
            value={draft.usernameHint}
            onChange={(event) => set('usernameHint', event.target.value)}
            placeholder="ana.r…@mail.ph"
            hint="Enough to recognise the account. Never a secret."
          />
          <TextField
            label="Sign-in address (optional)"
            type="url"
            value={draft.signInUrl}
            error={errors.signInUrl}
            onChange={(event) => set('signInUrl', event.target.value)}
            placeholder="https://myaccount.google.com"
          />
        </div>

        <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-sunken/40 p-3.5">
          <p className="text-sm font-semibold text-ink">Protection on this account</p>
          <CheckRow
            checked={draft.mfaEnabled}
            onChange={(value) => {
              set('mfaEnabled', value)
              if (value && draft.mfaMethod === 'none') set('mfaMethod', 'authenticator_app')
              if (!value) set('mfaMethod', 'none')
            }}
            label="Two-step verification is on"
            description="Signing in needs something besides the password."
          />
          <SelectField
            label="How the second factor works"
            value={draft.mfaMethod}
            options={mfaMethods}
            error={errors.mfaMethod}
            onChange={(event) => set('mfaMethod', event.target.value)}
            hint={draft.mfaEnabled ? undefined : 'Only needed when two-step verification is on.'}
          />
          <CheckRow
            checked={draft.storedInPasswordManager}
            onChange={(value) => set('storedInPasswordManager', value)}
            label="The password lives in a password manager"
            description="You do not reuse it and do not type it from memory."
          />
          <CheckRow
            checked={draft.uniquePasswordClaimed}
            onChange={(value) => set('uniquePasswordClaimed', value)}
            label="This password is used nowhere else"
            description="A leak at one service cannot unlock another."
          />
          <CheckRow
            checked={draft.recoveryConfigured}
            onChange={(value) => set('recoveryConfigured', value)}
            label="Recovery options are set"
            description="A backup email, phone or codes exist for getting the account back."
          />
          <CheckRow
            checked={draft.reportedBreached}
            onChange={(value) => set('reportedBreached', value)}
            tone="danger"
            label="I believe this account appeared in a breach"
            description="Marks it for a password change and raises its priority in your advice."
          />
          {draft.reportedBreached ? <Badge tone="danger">Flagged as breached - change this password at the service itself.</Badge> : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="How often to review (days)"
            type="number"
            min={7}
            max={365}
            value={String(draft.reviewIntervalDays)}
            error={errors.reviewIntervalDays}
            onChange={(event) => set('reviewIntervalDays', Number(event.target.value))}
            hint="Between 7 and 365 days. 90 suits most accounts."
          />
          <TextArea
            label="Note (optional)"
            value={draft.notes}
            onChange={(event) => set('notes', event.target.value)}
            rows={3}
            placeholder="Recovery email is my work address."
            hint="Up to 400 characters. Do not paste secrets or passwords here."
          />
        </div>
      </form>
    </Dialog>
  )
}
