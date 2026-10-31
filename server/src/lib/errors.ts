import { ZodError } from 'zod'
import { logger } from './logger'

export type ErrorCode =
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'account_locked'
  | 'mfa_required'
  | 'mfa_pending'
  | 'invalid_credentials'
  | 'token_invalid'
  | 'token_expired'
  | 'db_unavailable'
  | 'internal_error'

export class AppError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly details?: unknown
  readonly expose: boolean

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
    this.expose = status < 500
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'validation_failed', message, details)
  }
  static unauthorized(message = 'You must sign in to continue.') {
    return new AppError(401, 'unauthorized', message)
  }
  static forbidden(message = 'Your account is not allowed to do that.') {
    return new AppError(403, 'forbidden', message)
  }
  static notFound(message = 'That resource could not be found.') {
    return new AppError(404, 'not_found', message)
  }
  static conflict(message: string, details?: unknown) {
    return new AppError(409, 'conflict', message, details)
  }
  static rateLimited(message: string, retryAfterSeconds?: number, details?: unknown) {
    const error = new AppError(429, 'rate_limited', message, { retryAfterSeconds, ...(details as object) })
    return error
  }
}

export function toResponseBody(error: unknown) {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
    }
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'validation_failed',
          message: 'Some information needs correcting.',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.') || '(root)',
            message: issue.message,
          })),
        },
      },
    }
  }

  // Express and its middleware (a body over the size limit, for example) arrive
  // here as plain errors that already know their HTTP status.
  const frameworkStatus = frameworkClientError(error)
  if (frameworkStatus) {
    return {
      status: frameworkStatus,
      body: {
        error: {
          code: codeForStatus(frameworkStatus),
          message: FRAMEWORK_MESSAGES[frameworkStatus] ?? 'That request could not be completed.',
        },
      },
    }
  }

  // Database and framework faults must never leak structure or credentials.
  logger.error('Unhandled request error', { error })
  return {
    status: 500,
    body: { error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again.' } },
  }
}

const FRAMEWORK_MESSAGES: Record<number, string> = {
  400: 'That request could not be read.',
  403: 'That action is not allowed.',
  404: 'That address has no API route.',
  405: 'That action is not available at this address.',
  413: 'That is too much information for one request. Please send a smaller piece.',
  415: 'That kind of data is not accepted here.',
  429: 'Too many attempts in a short time. Please wait a moment and try again.',
}

function frameworkClientError(error: unknown): number | undefined {
  const candidate = error as { status?: unknown; statusCode?: unknown } | null
  const raw = candidate?.status ?? candidate?.statusCode
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return undefined
  return raw >= 400 && raw < 500 ? raw : undefined
}

function codeForStatus(status: number): ErrorCode {
  if (status === 429) return 'rate_limited'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  return 'validation_failed'
}
