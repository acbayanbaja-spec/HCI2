import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import type { Request } from 'express'
import { AppError } from '../lib/errors'
import { env } from '../config/env'

/**
 * Limits are keyed by account when one is known and by IP otherwise, so a
 * shared office NAT cannot be punished as one user, while anonymous abuse of
 * the login form still has a ceiling.
 */
function key(req: Request): string {
  return req.user ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`
}

function limiter(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: key,
    handler: (req, _res, next) => next(AppError.rateLimited(message, Math.ceil(windowMs / 1000))),
  })
}

/** Credential stuffing and registration spam get the tightest budget. */
export const authLimiter = limiter(
  env.limits.authWindowMs,
  env.limits.authMax,
  'Too many attempts from here. Please wait a few minutes and try again.',
)

/** The analyzer is a heuristic engine, not a URL reputation service. */
export const analyzeLimiter = limiter(
  env.limits.analyzeWindowMs,
  env.limits.analyzeMax,
  'That was a lot of checks in a short time. Give it a rest for a few minutes.',
)

/** Broad guard for everything else, so a runaway client cannot hammer the API. */
export const apiLimiter = limiter(60_000, 300, 'You are sending requests too quickly. Slow down for a moment.')
