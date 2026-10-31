import type { NextFunction, Request, Response } from 'express'
import { AppError, toResponseBody } from '../lib/errors'
import { logger } from '../lib/logger'

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `No API route matches ${req.method} ${req.path}.` },
  })
}

/**
 * One exit door for every failure. Anything that is not an AppError is logged
 * in full and answered with a generic sentence, so a database fault can never
 * print a connection string.
 */
export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error)
    return
  }

  const { status, body } = toResponseBody(error)

  if (status >= 500) {
    logger.error('Request failed', { method: req.method, path: req.path, error })
  }

  if (error instanceof AppError && status === 429) {
    const details = error.details as { retryAfterSeconds?: number } | undefined
    if (details?.retryAfterSeconds) res.set('Retry-After', String(details.retryAfterSeconds))
  }

  res.status(status).json(body)
}

/** Body size is capped so a request cannot exhaust memory on a string. */
export const MAX_JSON_BYTES = 64 * 1024

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint()
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6
    logger.info('request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(ms * 100) / 100,
      userId: req.user?.id,
    })
  })
  next()
}
