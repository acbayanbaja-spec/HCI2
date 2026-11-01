import { createApp } from './app'
import { env } from './config/env'
import { logger } from './lib/logger'
import { explainDatabaseError } from './db/connection-url'
import { runMigrations } from './db/migrate'
import { closePool, waitForDatabase } from './db/pool'
import { purgeExpiredSessions } from './services/session.service'

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000

async function sweep() {
  const removed = await purgeExpiredSessions()
  if (removed > 0) logger.info('Purged expired sessions', { removed })
}

async function main() {
  const app = createApp()
  // Bind PORT before talking to Postgres so Render does not treat a password
  // retry as "no open ports" and kill the instance mid-boot.
  const server = app.listen(env.port, () => {
    logger.info('Digital Guardian API listening', { port: env.port, env: env.nodeEnv })
  })

  try {
    await waitForDatabase()
    await runMigrations({ onMessage: (message) => logger.info(message) })
  } catch (error) {
    logger.error('API could not start', { error: explainDatabaseError(error, env.database.target) })
    await closePool().catch(() => undefined)
    server.close()
    process.exit(1)
  }

  await sweep().catch((error) => logger.warn('First session sweep failed', { error }))
  const timer = setInterval(() => {
    sweep().catch((error) => logger.error('Session sweep failed', { error }))
  }, SWEEP_INTERVAL_MS)

  let closing = false
  const shutdown = (signal: string) => {
    if (closing) return
    closing = true
    logger.info('Shutting down', { signal })
    clearInterval(timer)
    server.close(() => {
      closePool().then(
        () => process.exit(0),
        () => process.exit(1),
      )
    })
    // A connection that will not drain must not outlive a deploy slot.
    setTimeout(() => process.exit(1), 10_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', { error: reason }))
}

main().catch(async (error) => {
  logger.error('API could not start', { error: explainDatabaseError(error, env.database.target) })
  await closePool().catch(() => undefined)
  process.exit(1)
})
