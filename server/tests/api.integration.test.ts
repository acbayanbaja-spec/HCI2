import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateSync } from 'otplib'
import type { Express } from 'express'
import { Api, tokenFromLink } from './helpers/api'
import { closeTestDatabase, prepareTestDatabase, serverRoot } from './helpers/test-database'

/**
 * These tests drive the real HTTP surface: a real PostgreSQL, real argon2
 * hashing, real cookies, real CSRF checks and real rate limits. Nothing is
 * stubbed, so a pass means the flow works for a browser.
 */

const PASSWORD = 'Lantern-River-42-Cove'
const DISPLAY_NAME = 'Ana Reyes'
const PHISHING_URL = 'http://paypa1-secure-login.com/signin?token=abc'
const SAFE_URL = 'https://www.google.com.ph/'

let app: Express
let seq = 0

function newEmail(label: string): string {
  seq += 1
  return `dg.${label}.${seq}.${Date.now().toString(36)}@example.test`
}

function totp(secret: string): string {
  return String(generateSync({ secret }))
}

type Body = Record<string, any>

async function register(label: string, overrides: Body = {}) {
  const api = new Api(app)
  const email = newEmail(label)
  const res = await api.post('/api/auth/register', { email, password: PASSWORD, displayName: DISPLAY_NAME, ...overrides })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return { api, email, user: res.body.user as Body }
}

async function signInFresh(label: string) {
  const { api, email } = await register(label)
  const res = await api.post('/api/auth/login', { email, password: PASSWORD })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  expect(res.body.authenticated).toBe(true)
  return { api, email }
}

beforeAll(async () => {
  await prepareTestDatabase()
  const { createApp } = await import('../src/app.js')
  app = createApp()
})

afterAll(async () => {
  await closeTestDatabase()
})

/* ------------------------------------------------------------------ health */

describe('service health and hardening', () => {
  it('answers the liveness probe without touching the database', async () => {
    const res = await new Api(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('answers the readiness probe only while the database is reachable', async () => {
    const res = await new Api(app).get('/health/ready')
    expect(res.status).toBe(200)
    expect(res.body.database).toBe('connected')
  })

  it('sends security response headers and hides the framework', async () => {
    const res = await new Api(app).get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('only reflects an allowlisted origin', async () => {
    const allowed = await new Api(app).get('/health', { headers: { Origin: 'http://localhost:5173' } })
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(allowed.headers['access-control-allow-credentials']).toBe('true')

    const stranger = await new Api(app).get('/health', { headers: { Origin: 'https://evil.example' } })
    expect(stranger.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('answers an unknown route with a JSON error instead of HTML', async () => {
    const res = await new Api(app).get('/api/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('not_found')
  })

  it('rejects an oversized body instead of exhausting memory', async () => {
    const res = await new Api(app).post('/api/auth/forgot-password', { email: 'x'.repeat(200_000) })
    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('validation_failed')
  })
})

/* ----------------------------------------------------------- registration */

describe('registration and password policy', () => {
  it('refuses a password below the minimum length', async () => {
    const res = await new Api(app).post('/api/auth/register', { email: newEmail('short'), password: 'Sun!12', displayName: 'Ana' })
    expect(res.status).toBe(400)
    expect(res.body.error.details.issues.some((issue: Body) => issue.field === 'password')).toBe(true)
  })

  it('refuses a commonly used password and says why', async () => {
    const res = await new Api(app).post('/api/auth/register', { email: newEmail('common'), password: 'password1234', displayName: 'Ana' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('validation_failed')
    expect(res.body.error.message).toMatch(/not strong enough/i)
  })

  it('publishes the same lock rules the server enforces', async () => {
    const res = await new Api(app).get('/api/auth/policy')
    expect(res.status).toBe(200)
    expect(res.body.minPasswordLength).toBe(12)
    expect(res.body.maxFailedLogins).toBe(3)
    expect(res.body.mailDelivery).toBe('outbox')
  })

  it('creates an account and confirms the address through the mailed token', async () => {
    const { email, user } = await register('owner')
    expect(user.email).toBe(email)
    expect(user.emailVerified).toBe(false)
    expect(user.role).toBe('user')
    // The API must never accept or return an external account password.
    expect(JSON.stringify(user)).not.toMatch(/password/i)

    const message = Api.readOutboxMessage(serverRoot, email, 'Confirm your Digital Guardian account')
    expect(message, 'the confirmation message should reach the local outbox').not.toBeNull()

    const api = new Api(app)
    const verified = await api.post('/api/auth/verify-email', { token: tokenFromLink(message!.text) })
    expect(verified.status).toBe(200)
    expect(verified.body.verified).toBe(true)

    const replay = await api.post('/api/auth/verify-email', { token: tokenFromLink(message!.text) })
    expect(replay.status).toBe(400)

    const after = await api.post('/api/auth/login', { email, password: PASSWORD })
    expect(after.status).toBe(200)
    expect(after.body.user.emailVerified).toBe(true)
  })

  it('rejects a duplicate email address whatever its casing', async () => {
    const { email } = await register('dupe')
    const res = await new Api(app).post('/api/auth/register', { email: email.toUpperCase(), password: PASSWORD, displayName: DISPLAY_NAME })
    expect(res.status).toBe(409)
  })

  it('does not reveal whether an email address is registered', async () => {
    const { email } = await register('exists')
    const api = new Api(app)
    const wrongPassword = await api.post('/api/auth/login', { email, password: 'Winter-Kite-77-Shell' })
    const noAccount = await api.post('/api/auth/login', { email: newEmail('nobody'), password: 'Winter-Kite-77-Shell' })
    expect(wrongPassword.status).toBe(401)
    expect(noAccount.status).toBe(401)
    expect(wrongPassword.body.error.message).toBe(noAccount.body.error.message)
  })
})

/* ---------------------------------------------------------------- sessions */

describe('sessions and cookies', () => {
  it('issues httpOnly session cookies plus a CSRF token the page can read', async () => {
    const { email } = await register('cookie')
    const res = await new Api(app).post('/api/auth/login', { email, password: PASSWORD })
    expect(res.status).toBe(200)

    const lines = res.headers['set-cookie'] as unknown as string[]
    const access = lines.find((line) => line.startsWith('dg_access='))
    const refresh = lines.find((line) => line.startsWith('dg_refresh='))
    const csrf = lines.find((line) => line.startsWith('dg_csrf='))

    expect(access).toMatch(/HttpOnly/i)
    expect(refresh).toMatch(/HttpOnly/i)
    expect(refresh).toMatch(/SameSite=Lax/i)
    expect(csrf).toBeDefined()
    expect(csrf).not.toMatch(/HttpOnly/i)
    expect(res.body.csrfToken).toBeTruthy()
  })

  it('refuses a protected endpoint without a session', async () => {
    const res = await new Api(app).get('/api/dashboard')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('unauthorized')
  })

  it('labels a password-only session as unverified instead of claiming two-step', async () => {
    const { api } = await signInFresh('mfa-label')

    const me = await api.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.mfaVerified).toBe(false)

    const sessions = await api.get('/api/settings/sessions')
    const current = sessions.body.sessions.find((item: Body) => item.isCurrent) as Body
    expect(current.signedInWithMfa).toBe(false)
  })

  it('accepts a bearer token for the same session', async () => {
    const { api } = await signInFresh('bearer')
    const token = api.cookieValue('dg_access')
    expect(token).toBeTruthy()

    const res = await new Api(app).get('/api/score', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    expect(typeof res.body.score).toBe('number')
  })

  it('blocks a cookie-only mutation that carries no CSRF proof', async () => {
    const { api } = await signInFresh('csrf')
    const payload = { providerName: 'Gmail', category: 'email' }

    const withoutHeader = await api.post('/api/accounts', payload, { csrf: false })
    expect(withoutHeader.status).toBe(403)
    expect(withoutHeader.body.error.message).toMatch(/browser/i)

    const forged = await api.post('/api/accounts', payload, { headers: { 'x-csrf-token': 'not-the-token' } })
    expect(forged.status).toBe(403)

    const withHeader = await api.post('/api/accounts', payload)
    expect(withHeader.status).toBe(201)

    // A bearer-token call is not a browser form post, so CSRF does not apply.
    const token = api.cookieValue('dg_access')!
    const viaBearer = await new Api(app).post(
      '/api/accounts',
      { providerName: 'Shopee', category: 'shopping' },
      { headers: { Authorization: `Bearer ${token}` } },
    )
    expect(viaBearer.status).toBe(201)
  })

  it('rotates the refresh token and kills the family when a token is replayed', async () => {
    const { api } = await signInFresh('rotate')
    const stale = api.cookieValue('dg_refresh')
    expect(stale).toBeTruthy()

    const refreshed = await api.post('/api/auth/refresh')
    expect(refreshed.status).toBe(200)
    expect(api.cookieValue('dg_refresh')).not.toBe(stale)

    const replay = await api.post('/api/auth/refresh', undefined, { headers: { Cookie: `dg_refresh=${stale}` }, csrf: false })
    expect(replay.status).toBe(401)
    expect(replay.body.error.message).toMatch(/safety/i)

    // Reuse detection ends the whole family, including the freshly issued token.
    const afterReuse = await api.get('/api/auth/me')
    expect(afterReuse.status).toBe(401)
  })

  it('signs out by ending the session and clearing the cookies', async () => {
    const { api } = await signInFresh('logout')
    expect((await api.get('/api/auth/me')).status).toBe(200)

    const out = await api.post('/api/auth/logout')
    expect(out.status).toBe(204)
    expect(api.signedOut()).toBe(true)

    const after = await api.get('/api/auth/me')
    expect(after.status).toBe(401)
  })

  it('pauses sign-in after repeated failures, correct password included', async () => {
    const { email } = await register('locked')
    const api = new Api(app)

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const fail = await api.post('/api/auth/login', { email, password: 'Not-My-Password-99' })
      expect(fail.status).toBe(401)
    }

    const third = await api.post('/api/auth/login', { email, password: 'Not-My-Password-99' })
    expect(third.status).toBe(429)
    expect(third.body.error.code).toBe('account_locked')
    expect(third.headers['retry-after']).toBeDefined()

    const evenCorrect = await api.post('/api/auth/login', { email, password: PASSWORD })
    expect(evenCorrect.status).toBe(429)
  })
})

/* ------------------------------------------------------------ two factors */

describe('two-step verification', () => {
  it('enrols, demands the code on the next sign-in, and honours a recovery code once', async () => {
    const { api, email } = await signInFresh('mfa')

    const setup = await api.post('/api/settings/mfa/setup')
    expect(setup.status).toBe(200)
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/Digital%20Guardian/)
    expect(setup.body.steps).toHaveLength(3)

    const secret = setup.body.manualCode as string
    expect((await api.post('/api/settings/mfa/enable', { code: '000000' })).status).toBe(400)

    const enabled = await api.post('/api/settings/mfa/enable', { code: totp(secret) })
    expect(enabled.status).toBe(200)
    expect(enabled.body.enabled).toBe(true)
    expect(enabled.body.recoveryCodes).toHaveLength(10)
    const recovery = enabled.body.recoveryCodes[0] as string
    expect(recovery).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/)

    expect((await api.post('/api/auth/logout')).status).toBe(204)

    const first = await api.post('/api/auth/login', { email, password: PASSWORD })
    expect(first.status).toBe(202)
    expect(first.body.mfaRequired).toBe(true)
    const sessionId = first.body.sessionId as string
    expect(sessionId).toBeTruthy()
    // No session cookie may be issued before the second factor.
    expect(api.cookieValue('dg_access')).toBeUndefined()

    expect((await api.post('/api/auth/login/mfa', { sessionId, code: '123456' })).status).toBe(401)

    const verified = await api.post('/api/auth/login/mfa', { sessionId, code: totp(secret) })
    expect(verified.status).toBe(200)
    expect(verified.body.authenticated).toBe(true)

    const me = await api.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.mfaVerified).toBe(true)
    expect(me.body.user.mfaEnabled).toBe(true)

    // The same endpoint takes a recovery code, and each code works once only.
    await api.post('/api/auth/logout')
    const second = await api.post('/api/auth/login', { email, password: PASSWORD })
    expect(second.status).toBe(202)
    const withRecovery = await api.post('/api/auth/login/mfa', { sessionId: second.body.sessionId, code: recovery })
    expect(withRecovery.status, JSON.stringify(withRecovery.body)).toBe(200)

    await api.post('/api/auth/logout')
    const third = await api.post('/api/auth/login', { email, password: PASSWORD })
    const replay = await api.post('/api/auth/login/mfa', { sessionId: third.body.sessionId, code: recovery })
    expect(replay.status).toBe(401)

    // Rotating the codes needs a finished sign-in, so use the app code again.
    await api.post('/api/auth/logout')
    const fourth = await api.post('/api/auth/login', { email, password: PASSWORD })
    expect((await api.post('/api/auth/login/mfa', { sessionId: fourth.body.sessionId, code: totp(secret) })).status).toBe(200)

    const refreshed = await api.post('/api/settings/mfa/recovery-codes')
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200)
    expect(refreshed.body.recoveryCodes).toHaveLength(10)

    const disabled = await api.post('/api/settings/mfa/disable', { password: PASSWORD, code: totp(secret) })
    expect(disabled.status).toBe(200)
    expect(disabled.body.enabled).toBe(false)
    // Switching it off signs every device out, so this caller has no session left.
    expect((await api.get('/api/auth/me')).status).toBe(401)
  })

  it('rejects a second factor for a session that never asked for one', async () => {
    const res = await new Api(app).post('/api/auth/login/mfa', { sessionId: '11111111-1111-4111-8111-111111111111', code: '654321' })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})

/* --------------------------------------- accounts, score, recommendations */

describe('digital accounts and the safety score', () => {
  it('tracks accounts without ever accepting a password', async () => {
    const { api } = await signInFresh('accounts')

    const created = await api.post('/api/accounts', {
      providerName: 'GCash',
      category: 'finance',
      mfaEnabled: false,
      storedInPasswordManager: false,
      reviewIntervalDays: 90,
    })
    expect(created.status).toBe(201)
    expect(created.body.account.mfaEnabled).toBe(false)
    expect(created.body.account).not.toHaveProperty('password')

    // A stray password field is dropped by validation, never stored or echoed.
    const sneaky = await api.post('/api/accounts', { providerName: 'Maya', category: 'finance', password: 'hunter2hunter2' })
    expect(sneaky.status).toBe(201)
    expect(JSON.stringify(sneaky.body)).not.toMatch(/hunter2hunter2/)

    const gcashId = created.body.account.id as string
    const mayaId = sneaky.body.account.id as string

    const list = await api.get('/api/accounts')
    expect(list.body.accounts).toHaveLength(2)

    const reviewed = await api.post(`/api/accounts/${mayaId}/review`)
    expect(reviewed.status).toBe(200)
    expect(reviewed.body.account.daysSinceReview).toBe(0)

    const removed = await api.del(`/api/accounts/${gcashId}`)
    expect(removed.status).toBe(200)
    expect((await api.get(`/api/accounts/${gcashId}`)).status).toBe(404)
    expect((await api.get(`/api/accounts/${mayaId}`)).status).toBe(200)

    const intruder = await signInFresh('nosy')
    expect((await intruder.api.get(`/api/accounts/${mayaId}`)).status).toBe(404)
    expect((await intruder.api.del(`/api/accounts/${mayaId}`)).status).toBe(404)

    const options = await api.get('/api/accounts/meta/options')
    expect(options.status).toBe(200)
    expect(options.body.categories).toContain('finance')
    expect(options.body.mfaMethods).toContain('authenticator_app')
  })

  it('moves the score when a protection is really added, and only then', async () => {
    const { api } = await signInFresh('score')

    const score = await api.get('/api/score')
    expect(score.status).toBe(200)
    expect(score.body.score).toBeGreaterThanOrEqual(0)
    expect(score.body.score).toBeLessThanOrEqual(100)
    expect(score.body.factors.length).toBeGreaterThan(5)
    expect(score.body.howItWorks).toHaveLength(4)
    for (const factor of score.body.factors) {
      expect(String(factor.reason).length).toBeGreaterThan(20)
      expect(factor.earned).toBeLessThanOrEqual(factor.weight)
    }

    const maya = await api.post('/api/accounts', { providerName: 'Maya', category: 'finance', mfaEnabled: false, reviewIntervalDays: 90 })
    const mayaId = maya.body.account.id as string

    const full = {
      providerName: 'Maya',
      category: 'finance',
      mfaEnabled: true,
      mfaMethod: 'authenticator_app',
      storedInPasswordManager: true,
      uniquePasswordClaimed: true,
      recoveryConfigured: true,
      reviewIntervalDays: 90,
    }
    const upgraded = await api.put(`/api/accounts/${mayaId}`, full)
    expect(upgraded.status).toBe(200)
    expect(upgraded.body.account.mfaEnabled).toBe(true)

    const withMfa = await api.get('/api/score')
    const without = await api.put(`/api/accounts/${mayaId}`, { ...full, mfaEnabled: false, mfaMethod: 'none' })
    expect(without.status).toBe(200)
    const downgraded = await api.get('/api/score')
    expect(downgraded.body.score).toBeLessThan(withMfa.body.score)

    await api.put(`/api/accounts/${mayaId}`, full)
    const restored = await api.get('/api/score')
    expect(restored.body.score).toBe(withMfa.body.score)

    // Turning on two-step verification for the Digital Guardian account itself
    // must also move the number, because it is a real protection.
    const setup = await api.post('/api/settings/mfa/setup')
    const enabled = await api.post('/api/settings/mfa/enable', { code: totp(setup.body.manualCode as string) })
    expect(enabled.status).toBe(200)
    const afterPlatformMfa = await api.get('/api/score')
    expect(afterPlatformMfa.body.score).toBeGreaterThan(restored.body.score)
  })

  it('recalculates deterministically and derives advice from real gaps', async () => {
    const { api } = await signInFresh('recs')

    const first = await api.get('/api/recommendations')
    expect(first.status).toBe(200)
    expect(first.body.recommendations.length).toBeGreaterThan(0)
    const open = first.body.recommendations.filter((item: Body) => item.status === 'open') as Body[]
    expect(open.length).toBeGreaterThan(0)
    const target = open[0] as Body
    expect(['high', 'medium', 'low']).toContain(target.priority)

    const completed = await api.patch(`/api/recommendations/${target.id}`, { status: 'completed' })
    expect(completed.status).toBe(200)
    expect(completed.body.recommendation.status).toBe('completed')
    expect(completed.body.message).toMatch(/recalculated/i)

    // Advice is a live mirror of the facts: an item the user did not really fix
    // returns on the next sync instead of silently disappearing.
    const revived = await api.get('/api/recommendations?status=open')
    expect(revived.body.recommendations.some((item: Body) => item.id === target.id)).toBe(true)

    const dismissed = await api.patch(`/api/recommendations/${target.id}`, { status: 'dismissed' })
    expect(dismissed.body.recommendation.status).toBe('dismissed')
    const after = await api.get('/api/recommendations?status=open')
    expect(after.body.recommendations.some((item: Body) => item.id === target.id)).toBe(false)

    const recalcA = await api.post('/api/score/recalculate')
    const recalcB = await api.post('/api/score/recalculate')
    expect(recalcA.body.score).toBe(recalcB.body.score)
    expect(recalcA.body.fingerprint).toBe(recalcB.body.fingerprint)

    const history = await api.get('/api/score/history?limit=5')
    expect(history.status).toBe(200)
    expect(history.body.history.length).toBeGreaterThan(1)
    expect(history.body.history[0].trigger).toBe('manual')

    const dashboard = await api.get('/api/dashboard')
    expect(dashboard.status).toBe(200)
    expect(dashboard.body.score.score).toBe(recalcB.body.score)
    expect(dashboard.body.status.headline).toBeTruthy()
    expect(dashboard.body.accounts.total).toBe(0)
    expect(dashboard.body.signals.emailVerified).toBe(false)
    expect(dashboard.body.activeSessions).toBeGreaterThanOrEqual(1)
    expect(dashboard.body.priorityActions.length).toBeGreaterThan(0)
  })

  it('validates input and refuses a malformed record', async () => {
    const { api } = await signInFresh('validate')
    const bad = await api.post('/api/accounts', { providerName: '', category: 'not-a-category', signInUrl: 'not a url' })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('validation_failed')
    expect(bad.body.error.details.issues.length).toBeGreaterThanOrEqual(2)

    expect((await api.get('/api/accounts/nope')).status).toBe(400)
    expect((await api.patch('/api/recommendations/nope', { status: 'completed' })).status).toBe(400)
    expect((await api.get('/api/notifications?filter=nope')).status).toBe(400)
  })
})

/* ----------------------------------------------------------- the analyzer */

describe('link and message analyzer', () => {
  it('flags a look-alike payment page as high risk, with reasons', async () => {
    const { api } = await signInFresh('analyze')
    const res = await api.post('/api/analyze', { kind: 'url', input: PHISHING_URL })
    expect(res.status).toBe(201)
    expect(res.body.verdict).toBe('high')
    expect(res.body.riskScore).toBeGreaterThanOrEqual(80)
    expect(res.body.indicators.map((item: Body) => item.code)).toContain('typosquat')
    expect(res.body.guidance.length).toBeGreaterThan(0)
    expect(res.body.disclaimer).toMatch(/not a guarantee/i)
    expect(res.body.linksFound).toHaveLength(1)
  })

  it('does not flag a real brand domain', async () => {
    const { api } = await signInFresh('safe')
    const res = await api.post('/api/analyze', { kind: 'url', input: SAFE_URL })
    expect(res.status).toBe(201)
    expect(res.body.verdict).toBe('low')
  })

  it('reads a message and reports the links inside it', async () => {
    const { api } = await signInFresh('msg')
    const res = await api.post('/api/analyze', {
      kind: 'message',
      input: 'Hello customer, your GCash wallet is frozen. Click http://gcash-verify-topup.info now to release funds.',
    })
    expect(res.status).toBe(201)
    expect(['suspicious', 'high']).toContain(res.body.verdict)
    expect(res.body.linksFound).toHaveLength(1)
  })

  it('keeps a history that belongs to the signed-in user only', async () => {
    const { api } = await signInFresh('history')
    const first = await api.post('/api/analyze', { kind: 'url', input: PHISHING_URL })
    await api.post('/api/analyze', { kind: 'url', input: SAFE_URL })

    const list = await api.get('/api/analyses?limit=10')
    expect(list.body.analyses).toHaveLength(2)

    const detail = await api.get(`/api/analyses/${first.body.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.verdict).toBe('high')

    const intruder = await signInFresh('intruder')
    expect((await intruder.api.get(`/api/analyses/${first.body.id}`)).status).toBe(404)
  })

  it('files a report attached to an analysis, and blocks attaching someone else\u2019s', async () => {
    const { api } = await signInFresh('reporter')
    const analysis = await api.post('/api/analyze', { kind: 'url', input: PHISHING_URL })

    const report = await api.post('/api/reports', {
      analysisId: analysis.body.id,
      target: PHISHING_URL,
      claimedBrand: 'PayPal',
      reason: 'I got this by text and it asked for my password.',
    })
    expect(report.status).toBe(201)
    expect(report.body.status).toBe('new')
    expect(report.body.message).toMatch(/administrator/i)

    expect((await api.get('/api/reports')).body.reports).toHaveLength(1)
    expect((await api.get(`/api/reports/${report.body.id}`)).status).toBe(200)

    const other = await signInFresh('other-reporter')
    const hijack = await other.api.post('/api/reports', { analysisId: analysis.body.id, target: PHISHING_URL })
    expect(hijack.status).toBe(404)
    expect((await other.api.get(`/api/reports/${report.body.id}`)).status).toBe(404)

    expect((await api.post('/api/analyze', { kind: 'url', input: 'ab' })).status).toBe(400)
    expect((await api.post('/api/analyze', { kind: 'carrier-pigeon', input: 'https://example.com' })).status).toBe(400)
  })
})

/* -------------------------------------- profile, sessions, alerts, password */

describe('profile, sessions and notifications', () => {
  it('keeps a profile the owner can edit', async () => {
    const { api } = await signInFresh('profile')
    const loaded = await api.get('/api/settings/profile')
    expect(loaded.status).toBe(200)
    expect(loaded.body.privacyNote).toMatch(/does not sign in/i)
    expect(loaded.body.timezone).toBe('Asia/Manila')

    const saved = await api.put('/api/settings/profile', {
      displayName: 'Ana R.',
      fullName: 'Ana Reyes',
      preferredName: 'Ana',
      phone: '+63 917 555 0101',
      recoveryEmail: 'ana.backup@example.test',
      timezone: 'Asia/Manila',
      locale: 'en-PH',
    })
    expect(saved.status).toBe(200)
    expect(saved.body.profile.recoveryEmail).toBe('ana.backup@example.test')
    expect(saved.body.score.score).toBeGreaterThanOrEqual(0)

    const prefs = await api.put('/api/settings/preferences', { theme: 'dark', notifications: { learningNudges: false } })
    expect(prefs.status).toBe(200)
    expect(prefs.body.theme).toBe('dark')
    expect(prefs.body.notifications.learningNudges).toBe(false)

    const invalidPhone = await api.put('/api/settings/profile', {
      displayName: 'Ana R.',
      phone: 'not-a-phone',
      timezone: 'Asia/Manila',
      locale: 'en-PH',
    })
    expect(invalidPhone.status).toBe(400)
  })

  it('lists sessions with an honest note and signs out other devices', async () => {
    const { api, email } = await signInFresh('sessions')
    const other = new Api(app)
    expect((await other.post('/api/auth/login', { email, password: PASSWORD })).status).toBe(200)

    const list = await api.get('/api/settings/sessions')
    expect(list.status).toBe(200)
    expect(list.body.sessions.length).toBeGreaterThanOrEqual(2)
    expect(list.body.note).toMatch(/does not track a precise location/i)
    expect(JSON.stringify(list.body.sessions)).not.toMatch(/latitude|longitude/i)

    const current = list.body.sessions.find((item: Body) => item.isCurrent) as Body
    expect((await api.del(`/api/settings/sessions/${current.id}`)).status).toBe(400)

    const allOthers = await api.post('/api/settings/sessions/revoke-others')
    expect(allOthers.status).toBe(200)
    expect(allOthers.body.revokedSessions).toBeGreaterThanOrEqual(1)

    const after = await api.get('/api/settings/sessions')
    expect(after.body.sessions.filter((item: Body) => !item.isCurrent)).toHaveLength(0)
    expect((await other.get('/api/auth/me')).status).toBe(401)

    const summary = await api.get('/api/settings/sessions/summary')
    expect(summary.status).toBe(200)
    expect(summary.body.total).toBe(1)
  })

  it('records the security history and lets alerts be read or archived', async () => {
    const { api } = await signInFresh('activity')
    expect((await api.post('/api/accounts', { providerName: 'BDO Online', category: 'finance' })).status).toBe(201)

    const events = await api.get('/api/events?category=account_asset&limit=10')
    expect(events.status).toBe(200)
    expect(events.body.events.length).toBeGreaterThan(0)
    expect(events.body.note).toMatch(/cannot be edited/i)

    const search = await api.get('/api/events?search=registered&limit=10')
    expect(search.body.events.some((item: Body) => item.eventType === 'account_registered')).toBe(true)

    const injection = await api.get("/api/events?search=%25%27%20or%201%3D1--&limit=10")
    expect(injection.status).toBe(200)
    expect(injection.body.events).toHaveLength(0)

    const notifications = await api.get('/api/notifications')
    expect(notifications.status).toBe(200)
    expect(Array.isArray(notifications.body.notifications)).toBe(true)

    if (notifications.body.notifications.length > 0) {
      const id = notifications.body.notifications[0].id as string
      const read = await api.post(`/api/notifications/${id}/read`)
      expect(read.status).toBe(200)
      // Reading an alert is a scored input, so the number has to move with it
      // rather than wait for the user to press recalculate.
      expect(typeof read.body.score.score).toBe('number')
      const history = await api.get('/api/score/history?limit=1')
      expect(history.body.history[0].trigger).toBe('alerts_reviewed')

      const unread = await api.get('/api/notifications/unread-count')
      expect(unread.body.unread).toBe(notifications.body.unread - 1)
      expect((await api.post(`/api/notifications/${id}/archive`)).status).toBe(200)
    }

    expect((await api.post('/api/notifications/read-all')).status).toBe(200)
    expect((await api.get('/api/notifications/unread-count')).body.unread).toBe(0)

    const clearedScore = await api.get('/api/score')
    const hygiene = clearedScore.body.factors.find((item: Body) => item.key === 'alert_hygiene') as Body
    expect(hygiene.status, JSON.stringify(hygiene)).toBe('satisfied')

    const stranger = await signInFresh('stranger-alerts')
    const foreign = notifications.body.notifications[0]?.id as string | undefined
    if (foreign) expect((await stranger.api.post(`/api/notifications/${foreign}/read`)).status).toBe(404)
  })

  it('changes the password and signs every other device out', async () => {
    const { api, email } = await signInFresh('password')
    const other = new Api(app)
    await other.post('/api/auth/login', { email, password: PASSWORD })

    const wrongCurrent = await api.put('/api/settings/password', { currentPassword: 'Not-My-Password-99', newPassword: 'Copper-Kettle-31-Tide' })
    expect(wrongCurrent.status).toBe(401)

    const weak = await api.put('/api/settings/password', { currentPassword: PASSWORD, newPassword: 'abc123456789' })
    expect(weak.status).toBe(400)

    const same = await api.put('/api/settings/password', { currentPassword: PASSWORD, newPassword: PASSWORD })
    expect(same.status).toBe(400)

    const changed = await api.put('/api/settings/password', { currentPassword: PASSWORD, newPassword: 'Copper-Kettle-31-Tide' })
    expect(changed.status).toBe(200)
    expect(changed.body.revokedSessions).toBeGreaterThanOrEqual(1)

    expect((await other.get('/api/auth/me')).status).toBe(401)
    expect((await new Api(app).post('/api/auth/login', { email, password: PASSWORD })).status).toBe(401)
    expect((await new Api(app).post('/api/auth/login', { email, password: 'Copper-Kettle-31-Tide' })).status).toBe(200)
  })

  it('resets a forgotten password through the mailed link, once', async () => {
    const { api, email } = await signInFresh('reset')
    await api.post('/api/auth/logout')

    const forgot = await api.post('/api/auth/forgot-password', { email })
    expect(forgot.status).toBe(200)
    expect(forgot.body.accepted).toBe(true)

    const unknown = await api.post('/api/auth/forgot-password', { email: newEmail('nobody-again') })
    expect(unknown.status).toBe(200)
    expect(unknown.body.message).toBe(forgot.body.message)

    const message = Api.readOutboxMessage(serverRoot, email, 'Reset your Digital Guardian password')
    expect(message).not.toBeNull()
    const token = tokenFromLink(message!.text)

    expect((await api.post('/api/auth/reset-password', { token, newPassword: 'short1!' })).status).toBe(400)

    const reset = await api.post('/api/auth/reset-password', { token, newPassword: 'Marble-Spring-58-Anchor' })
    expect(reset.status).toBe(200)
    expect(reset.body.reset).toBe(true)

    expect((await api.post('/api/auth/reset-password', { token, newPassword: 'Marble-Spring-58-Anchor' })).status).toBe(400)

    const loggedIn = await api.post('/api/auth/login', { email, password: 'Marble-Spring-58-Anchor' })
    expect(loggedIn.status).toBe(200)
  })

  it('stops creating notifications for a category the user switched off', async () => {
    const muted = await signInFresh('muted')
    await muted.api.put('/api/settings/preferences', { notifications: { reportUpdates: false } })
    const mutedAnalysis = await muted.api.post('/api/analyze', { kind: 'url', input: PHISHING_URL })
    expect((await muted.api.post('/api/reports', { analysisId: mutedAnalysis.body.id, target: PHISHING_URL })).status).toBe(201)
    expect((await muted.api.get('/api/notifications?kind=report_update')).body.notifications).toHaveLength(0)

    const loud = await signInFresh('unmuted')
    const loudAnalysis = await loud.api.post('/api/analyze', { kind: 'url', input: PHISHING_URL })
    expect((await loud.api.post('/api/reports', { analysisId: loudAnalysis.body.id, target: PHISHING_URL })).status).toBe(201)
    const inbox = await loud.api.get('/api/notifications?kind=report_update')
    expect(inbox.body.notifications).toHaveLength(1)
    expect(inbox.body.notifications[0].title).toBe('Report received')
  })
})
