import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { BellRing, Info, MailOpen, Save } from 'lucide-react'
import { Card, CardBody, CardFooter, CardHeader, PageHeader } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, ErrorState, SkeletonList } from '../components/ui/feedback'
import { SwitchField } from '../components/ui/field'
import { api } from '../lib/api'
import type { NotificationPreferences, Profile } from '../lib/api-types'
import { useResource } from '../lib/use-resource'
import { useAuth } from '../state/auth'
import { useToast } from '../state/toast'

type EditableKey = Exclude<keyof NotificationPreferences, 'securityAlerts'>

const ITEMS: Array<{ key: EditableKey; label: string; description: string }> = [
  {
    key: 'recommendationDigests',
    label: 'Advice digests',
    description: 'A note when the engine has new work for you, rather than a ping for every small change.',
  },
  {
    key: 'reportUpdates',
    label: 'Updates to reports you filed',
    description: 'When an administrator reviews a phishing or scam report you submitted.',
  },
  {
    key: 'learningNudges',
    label: 'Learning reminders',
    description: 'Occasional prompts to finish a scenario or quiz you started.',
  },
  {
    key: 'emergencyReminders',
    label: 'Emergency response reminders',
    description: 'Prompts to keep your recovery steps ready before you ever need them.',
  },
]

export function NotificationSettingsPage() {
  const { push } = useToast()
  const { policy } = useAuth()
  const resource = useResource<Profile>((signal) => api.get('/api/settings/profile', { signal }), [])

  const [draft, setDraft] = useState<NotificationPreferences | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (resource.data && !draft) setDraft(resource.data.notifications)
  }, [resource.data, draft])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || saving) return
    setSaving(true)
    try {
      const result = await api.put<{ theme: string; notifications: NotificationPreferences }>('/api/settings/preferences', {
        notifications: {
          recommendationDigests: draft.recommendationDigests,
          reportUpdates: draft.reportUpdates,
          learningNudges: draft.learningNudges,
          emergencyReminders: draft.emergencyReminders,
        },
      })
      setDraft(result.notifications)
      resource.reload()
      push({ tone: 'good', title: 'Notification choices saved', description: 'Security alerts keep arriving regardless of these settings.' })
    } catch (error) {
      push({ tone: 'danger', title: 'Your choices were not saved', description: error instanceof Error ? error.message : 'Try again.' })
    } finally {
      setSaving(false)
    }
  }

  const loaded = resource.data?.notifications
  const dirty = !!draft && !!loaded && JSON.stringify(draft) !== JSON.stringify(loaded)

  return (
    <>
      <PageHeader
        title="Notifications"
        description="What Digital Guardian tells you about, and how often."
        actions={
          <Link to="/alerts">
            <Button variant="secondary">
              <BellRing className="size-4" aria-hidden="true" /> View alerts
            </Button>
          </Link>
        }
      />

      {resource.error ? (
        <div className="mt-5">
          <ErrorState title="Your notification settings did not load" message={resource.error.message} onRetry={resource.reload} />
        </div>
      ) : resource.loading || !draft ? (
        <div className="mt-5 space-y-4">
          <SkeletonList rows={3} />
        </div>
      ) : (
        <form onSubmit={save} className="mt-5 space-y-5">
          <Card>
            <CardHeader
              title="Always sent"
              description="These are not optional. A tool that let you silence a breach warning would not be a safety product."
            />
            <CardBody>
              <SwitchField
                label="Security alerts"
                description="Sign-ins from a new device, password changes, sessions signed out, two-step verification changes, and incidents on your own account."
                checked={true}
                disabled
                onChange={() => {}}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Choose what else reaches you" description="Stored with your account, so they follow you to any device." />
            <CardBody className="space-y-4">
              {ITEMS.map((item) => (
                <SwitchField
                  key={item.key}
                  label={item.label}
                  description={item.description}
                  checked={draft[item.key]}
                  onChange={(checked) => setDraft({ ...draft, [item.key]: checked })}
                />
              ))}
            </CardBody>
            <CardFooter className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-faint">{dirty ? 'You have unsaved changes.' : 'Everything here is saved.'}</p>
              <Button type="submit" loading={saving} disabled={!dirty}>
                <Save className="size-4" aria-hidden="true" /> Save choices
              </Button>
            </CardFooter>
          </Card>

          <Alert tone="info" Icon={MailOpen} title="Where alerts are delivered">
            <p className="text-sm">
              Everything appears in your <Link to="/alerts" className="font-semibold text-brand hover:underline">Alerts</Link> inbox
              first. {policy?.mailDelivery === 'smtp'
                ? 'Time-critical alerts are also emailed to your confirmed address.'
                : 'In this environment email is not connected, so mailed copies are written to the server outbox instead of being sent — nothing is silently dropped, and nothing is falsely claimed as delivered.'}
            </p>
          </Alert>

          <Alert tone="info" Icon={Info} title="What is never sent">
            <p className="text-sm">
              Digital Guardian does not email, text or message you on any other platform, does not sell or share these preferences,
              and does not contact you about anything it has not been asked to watch on your own account.
            </p>
          </Alert>
        </form>
      )}
    </>
  )
}
