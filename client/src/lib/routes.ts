/**
 * Advice and score factors name the screen that closes the gap. Some of those
 * screens ship in a later release, and a link that lands on "not found" is worse
 * than no link, so every target is checked against what the router really has.
 */
const SHIPPED_ROUTES = [
  '/dashboard',
  '/score',
  '/accounts',
  '/check-link',
  '/recommendations',
  '/alerts',
  '/activity',
  '/settings/profile',
  '/settings/security',
  '/settings/notifications',
  '/verify-email',
  '/reset-password',
  '/login',
  '/register',
  '/forgot-password',
]

export function isShippedTarget(href: string | null | undefined): boolean {
  if (!href) return false
  const path = href.split('?')[0]?.split('#')[0] ?? ''
  return SHIPPED_ROUTES.some((route) => path === route || path.startsWith(`${route}/`))
}

export const UNSHIPPED_NOTE = 'This area opens in a later release.'
