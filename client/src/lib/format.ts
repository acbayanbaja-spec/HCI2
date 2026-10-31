const dateTime = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' })

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return 'No record'
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'No record'
  return dateTime.format(date)
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return 'No record'
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'No record'
  return dateOnly.format(date)
}

/**
 * Short, human-relative ages for lists. Full timestamps stay available in the
 * title attribute so nothing is lost.
 */
export function formatRelative(value: string | Date): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  const abs = Math.abs(seconds)

  if (abs < 45) return seconds <= 0 ? 'Just now' : 'Moments ago'
  if (abs < 3600) return `${Math.round(abs / 60)} min ago`
  if (abs < 86_400) {
    const hours = Math.round(abs / 3600)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  if (abs < 2_592_000) {
    const days = Math.round(abs / 86_400)
    return `${days} day${days === 1 ? '' : 's'} ago`
  }
  return dateOnly.format(date)
}

export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'Never'
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}
