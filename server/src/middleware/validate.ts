import type { Request, RequestHandler } from 'express'
import { z } from 'zod'
import { AppError } from '../lib/errors'

/**
 * Every request body passes through a zod schema before a service sees it.
 * Parsing returns a new object, so unknown keys are dropped rather than
 * silently forwarded - a client cannot inject an extra column that way.
 */
export function validateBody<T extends z.ZodType>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) {
      next(describe(parsed.error))
      return
    }
    req.body = parsed.data
    next()
  }
}

/** Query strings arrive as text, so they need their own coercion step. */
export function parseQuery<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  const parsed = schema.safeParse(req.query)
  if (!parsed.success) throw describe(parsed.error)
  return parsed.data
}

/** Route parameters are the only place an id can come from. */
export function parseIdParam(req: Request, name = 'id'): string {
  const raw = req.params[name]
  const parsed = z.string().uuid('That reference is not valid.').safeParse(raw)
  if (!parsed.success) throw AppError.badRequest('That reference is not valid.')
  return parsed.data
}

function describe(error: z.ZodError): AppError {
  const issues = error.issues.map((issue) => ({
    field: issue.path.join('.') || '(request)',
    message: issue.message,
  }))
  const first = issues[0]
  return new AppError(400, 'validation_failed', first ? first.message : 'Some information needs correcting.', { issues })
}
