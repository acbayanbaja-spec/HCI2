import type { Request, Response } from 'express'
import { AppError } from '../lib/errors'

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth, re-read from the database on every request. */
      user?: { id: string; role: 'user' | 'admin'; mfaVerified: boolean }
      sessionId?: string
    }
  }
}

/** Reads the signed-in principal; throws if a route forgot its auth guard. */
export function principalOf(req: Request): { userId: string; sessionId: string; role: 'user' | 'admin' } {
  if (!req.user || !req.sessionId) throw AppError.unauthorized()
  return { userId: req.user.id, sessionId: req.sessionId, role: req.user.role }
}

export type AsyncHandler = (req: Request, res: Response) => Promise<void>
