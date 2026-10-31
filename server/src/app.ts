import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { env } from './config/env'
import { logger } from './lib/logger'
import { errorHandler, MAX_JSON_BYTES, notFoundHandler, requestLogger } from './middleware/errors'
import { requireCsrf } from './middleware/auth'
import { apiLimiter } from './middleware/rate-limit'
import { ping } from './db/pool'
import authRoutes from './http/routes/auth.routes'
import settingsRoutes from './http/routes/settings.routes'
import assetRoutes from './http/routes/asset.routes'
import analysisRoutes from './http/routes/analysis.routes'
import assessmentRoutes from './http/routes/assessment.routes'
import activityRoutes from './http/routes/activity.routes'

export function createApp() {
  const app = express()

  // Render and Vercel both terminate TLS in front of the app, so req.ip has to
  // come from the proxy header. A fixed hop count, not `true`, keeps a client
  // from inventing its own address.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(
    helmet({
      // This service only ever answers JSON, so a content security policy
      // belongs to the frontend deployment instead.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  )

  app.use(
    cors({
      origin(origin, callback) {
        // No origin: same-origin, a curl call, or a health probe.
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true)
          return
        }
        // Answering without CORS headers keeps the browser from reading the
        // response; failing the request would only turn a policy miss into a 500.
        logger.warn('Ignored a request from an origin outside the allowlist', { origin })
        callback(null, false)
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
      maxAge: 600,
    }),
  )

  app.use(express.json({ limit: MAX_JSON_BYTES }))
  if (!env.isTest) app.use(requestLogger)

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'digital-guardian-api', time: new Date().toISOString() })
  })

  app.get('/health/ready', async (_req, res) => {
    const databaseUp = await ping()
    res.status(databaseUp ? 200 : 503).json({
      status: databaseUp ? 'ready' : 'degraded',
      database: databaseUp ? 'connected' : 'unreachable',
    })
  })

  app.get('/api', (_req, res) => {
    res.json({
      name: 'Digital Guardian API',
      version: 1,
      groups: ['/api/auth', '/api/dashboard', '/api/score', '/api/recommendations', '/api/accounts', '/api/analyze', '/api/reports', '/api/notifications', '/api/events', '/api/settings'],
      documentation: 'README.md - API routes',
    })
  })

  app.use('/api/auth', authRoutes)

  // Everything below needs a live session (each route calls requireAuth) and
  // every state-changing cookie request also has to carry the CSRF proof.
  const protectedApi = express.Router()
  protectedApi.use(apiLimiter, requireCsrf)
  protectedApi.use(assessmentRoutes)
  protectedApi.use('/accounts', assetRoutes)
  protectedApi.use(analysisRoutes)
  protectedApi.use(activityRoutes)
  protectedApi.use('/settings', settingsRoutes)
  app.use('/api', protectedApi)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
