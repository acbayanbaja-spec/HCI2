import type { ApiErrorCode, ApiIssue } from './api-types'

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details: unknown

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** Validation failures carry one message per field, ready for a form. */
  get issues(): ApiIssue[] {
    const raw = (this.details as { issues?: unknown } | undefined)?.issues
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (item): item is ApiIssue => !!item && typeof (item as ApiIssue).field === 'string' && typeof (item as ApiIssue).message === 'string',
    )
  }

  get isSessionExpired() {
    return this.status === 401
  }
}

/** Absent means same origin, which is what the dev proxy and a proxied deploy give us. */
const RAW_BASE = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''
const BASE = RAW_BASE.replace(/\/+$/, '')

export const CSRF_COOKIE = 'dg_csrf'

function readCookie(name: string): string | null {
  const prefix = `${name}=`
  for (const part of document.cookie.split(';')) {
    const entry = part.trim()
    if (entry.startsWith(prefix)) return decodeURIComponent(entry.slice(prefix.length))
  }
  return null
}

/** The token the browser copies into the CSRF header. */
export function csrfToken(): string | null {
  return readCookie(CSRF_COOKIE)
}

/** True when this browser has had a session at all, so a 401 is worth one refresh. */
export function mightHaveSession() {
  return csrfToken() !== null || memoryCsrf !== null
}

type Methods = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const UNSAFE = new Set<Methods>(['POST', 'PUT', 'PATCH', 'DELETE'])

export type RequestOptions = {
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
  /** Set for endpoints that mint their own proof, or when deliberately probing without cookies. */
  credentials?: RequestCredentials
  skipRefresh?: boolean
}

/** One refresh at a time: parallel 401s must not each rotate the refresh token. */
let refreshInFlight: Promise<boolean> | null = null
let memoryCsrf: string | null = null
let onSessionLost: (() => void) | null = null

/** The auth provider listens here so an expired session lands on the sign-in page once. */
export function setSessionLostHandler(handler: (() => void) | null) {
  onSessionLost = handler
}

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch(`${BASE}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) return false
        rememberCsrf(await response.json().catch(() => null))
        return true
      } catch {
        return false
      } finally {
        refreshInFlight = null
      }
    })()
  }
  return refreshInFlight
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `${url}?${text}` : url
}

async function send(method: Methods, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, method })
  if (response.status === 204) return undefined

  const text = await response.text()
  let payload: unknown = undefined
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      // A proxy or cold start can answer with HTML; that is still a failure, not a crash.
      if (!response.ok) throw new ApiError(response.status, 'internal_error', 'The service answered in an unexpected way. Please try again.', { text: text.slice(0, 200) })
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
    throw new ApiError(
      response.status,
      (error?.code as ApiErrorCode) ?? (response.status === 404 ? 'not_found' : 'internal_error'),
      error?.message ?? 'Something went wrong on our side. Please try again.',
      error?.details,
    )
  }

  rememberCsrf(payload)
  return payload
}

/**
 * Sign-in and refresh also return the CSRF value in the body. That matters when
 * the API sits on another domain: the cookie is then unreadable here, but the
 * token still has to ride back in the header.
 */
function rememberCsrf(payload: unknown) {
  const token = (payload as { csrfToken?: unknown } | undefined)?.csrfToken
  if (typeof token === 'string' && token.length > 0) memoryCsrf = token
}

function currentCsrf(): string | null {
  return csrfToken() ?? memoryCsrf
}

/**
 * Every call sends cookies, and every state-changing call proves it came from
 * this tab by copying the CSRF token into a header a cross-site page cannot set.
 */
export async function request<T>(method: Methods, path: string, options: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, options.query)
  const headers: Record<string, string> = { Accept: 'application/json' }
  const csrf = currentCsrf()
  if (UNSAFE.has(method) && csrf) headers['X-CSRF-Token'] = csrf
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const init: RequestInit = {
    credentials: options.credentials ?? 'include',
    headers,
    signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }

  try {
    return (await send(method, url, init)) as T
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null
    const worthRefreshing = apiError?.isSessionExpired && !options.skipRefresh && mightHaveSession()
    if (!apiError || !worthRefreshing) throw error

    const renewed = await refreshSession()
    if (!renewed) {
      memoryCsrf = null
      onSessionLost?.()
      throw apiError
    }
    // The refresh rotated the token, so rebuild the header before replaying.
    const nextCsrf = currentCsrf()
    if (nextCsrf) headers['X-CSRF-Token'] = nextCsrf
    return (await send(method, url, { ...init, headers })) as T
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, { ...options, body }),
  del: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
}
