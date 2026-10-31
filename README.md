# DIGITAL GUARDIAN

**An Intelligent Personal Digital Safety and Security Management System**

Digital Guardian helps a person see how exposed they actually are, explains *why* in
plain language, and gives them something concrete to do next. It keeps a registry of
your digital accounts, scores your posture with a fully explainable risk model, checks
links and messages for phishing patterns, tracks the devices and sessions signed in to
your account, and remembers what it told you and when.

It does **not** store passwords to your external accounts, does **not** connect to any
third-party service on your behalf, and does **not** claim to see anything it cannot see.
Where the system's view is limited, the interface says so.

- Frontend: React 19 + Vite + Tailwind 4 → **Vercel**
- API: Node.js + Express 5 REST → **Render**
- Database: PostgreSQL → **Supabase**
- All credentials via environment variables. Nothing secret is committed.

---

## Contents

1. [What works today](#what-works-today)
2. [Architecture](#architecture)
3. [Run it locally](#run-it-locally)
4. [Configuration](#configuration)
5. [Security model](#security-model)
6. [The Digital Safety Score](#the-digital-safety-score)
7. [API routes](#api-routes)
8. [Database](#database)
9. [Testing and verification](#testing-and-verification)
10. [Deployment](#deployment)
11. [Troubleshooting](#troubleshooting)
12. [Accessibility and UX commitments](#accessibility-and-ux-commitments)
13. [Roadmap](#roadmap)

---

## What works today

Built, wired to a screen, and verified against a running stack:

| Capability | State |
| --- | --- |
| Registration, sign-in, email verification, password reset | working |
| Two-step verification (TOTP) with one-time recovery codes | working |
| Session and device monitoring, revoke one / revoke others | working |
| Digital Safety Score with per-factor reasons and full history | working |
| Adaptive recommendations that update as you act | working |
| Digital account registry (labels and hygiene, never passwords) | working |
| Link and message analyzer with four severity bands | working |
| Secure reporting of a suspicious item, with history | working |
| Alerts, notification preferences, read/archive that re-scores | working |
| Security activity history with search and filters | working |
| Profile and password settings, dark and light themes | working |

Modelled in the database, screen not built yet — these arrive in Phase 2 and are labelled
unavailable in the interface rather than faked: privacy checklist and digital-footprint
centre, incident reporting with timeline, Emergency Response Mode, learning hub, and the
admin security centre with role-based access control.

---

## Architecture

```
Browser
  │  React 19 SPA (Vite, Tailwind 4, react-router 7)
  │  httpOnly session cookies + x-csrf-token header
  ▼
Express 5 REST API  ──►  PostgreSQL (Supabase in production)
  helmet · CORS allowlist · zod validation · rate limits · argon2id
```

```
.
├── client/            React SPA
│   └── src/
│       ├── pages/     one file per screen
│       ├── components/  app shell, dialogs, primitives in ui/
│       ├── lib/       api client, useResource, severity, routes, alert-bus
│       └── state/     auth, theme, toast providers
├── server/            Express REST API
│   └── src/
│       ├── config/    env schema and cross-field validation
│       ├── db/        pool, checksummed migration runner, migrations/
│       ├── http/      cookies, route modules
│       ├── lib/       crypto, tokens, mfa, password policy, logger, errors
│       ├── middleware/ auth, csrf, rate limit, validate, error handler
│       └── services/  auth, sessions, score, recommendations, analyzer, mail…
└── scripts/           dev-db.mjs (embedded Postgres), verify.mjs
```

npm workspaces tie the two packages together, so one `npm install` at the root serves both.

---

## Run it locally

Requirements: **Node 24** (`engines` in the root `package.json` and `.node-version` both
pin it, so Vercel and Render cannot silently build on a different major) and npm 10+. No
database installation is needed — `db:start` runs a disposable PostgreSQL cluster inside
the repo. That cluster uses a per-platform binary held in `optionalDependencies`, so
`npm ci` works on Linux hosts and skips it; on macOS or Linux, point `DATABASE_URL` at any
PostgreSQL 16+ instance instead.

```bash
npm install
npm run db:start      # embedded Postgres on 127.0.0.1:5543 + writes server/.env with dev-only secrets
npm run migrate       # applies the 7 migrations
npm run seed          # optional: the privacy checklist catalogue
npm run dev           # API on http://127.0.0.1:4000, client on http://localhost:5173
```

Open <http://localhost:5173> and register.

**Email without a mail server.** With `SMTP_HOST` empty, verification and password-reset
messages are written as plain text to `server/.outbox/`. Open the newest file and follow
its link. The screens say this out loud instead of pretending mail was sent.

| Script | What it does |
| --- | --- |
| `npm run db:start` / `db:stop` / `db:status` | manage the local cluster |
| `npm run db:reset` | destroy and recreate the local database |
| `npm run gen:secrets` | print fresh dev secrets |
| `npm run migrate` | apply pending migrations |
| `npm run seed` | idempotent upserts of the privacy checklist catalogue |
| `npm run dev` | API + client with hot reload |
| `npm run typecheck` | strict TypeScript in both workspaces |
| `npm run test` | unit and API integration tests against a real database |
| `npm run verify` | typecheck → tests → both production builds |

---

## Configuration

Copy `server/.env.example` to `server/.env` (`db:start` does this for you locally) and
`client/.env.example` to `client/.env.local` only if you need to override the API origin.
Both `.env` files are git-ignored; only the `.env.example` templates are committed.

| Variable | Notes |
| --- | --- |
| `NODE_ENV`, `PORT` | `production` turns on the strict checks below; Render supplies `PORT` |
| `DATABASE_URL` | full connection string, including `sslmode=require` in production |
| `PGSSL` | `true` in production; `PGSSL_ROOT_CERT` supplies a private CA, `PGSSL_INSECURE=true` disables verification and is never appropriate for production |
| `DB_POOL_MAX`, `DB_STATEMENT_TIMEOUT_MS` | pool ceiling and per-connection statement timeout |
| `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` | ≥ 32 characters each, and they must differ |
| `DATA_ENCRYPTION_KEY` | 64 hex characters; encrypts MFA secrets at rest |
| `CORS_ORIGINS` | comma-separated exact origins, `https://` only in production |
| `COOKIE_SECURE`, `COOKIE_SAME_SITE`, `COOKIE_DOMAIN` | see the cookie rules below |
| `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS` | token lifetimes |
| `MAX_FAILED_LOGINS`, `ACCOUNT_LOCK_MINUTES` | lockout thresholds |
| `AUTH_RATE_LIMIT_*`, `ANALYZE_RATE_LIMIT_*` | window size and request ceiling |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | required in production |
| `APP_CLIENT_URL` | origin used to build the links inside verification and reset emails |
| `VITE_API_BASE_URL` | client only, read at build time; empty means same origin |

`server/src/config/env.ts` validates all of this and **refuses to boot** rather than
running in a half-secured state. It enforces: unique secrets of the right length,
`COOKIE_SAME_SITE=none` only together with `COOKIE_SECURE=true`, and in production
`COOKIE_SECURE=true`, `PGSSL=true`, HTTPS-only CORS origins with no localhost, and a
configured `SMTP_HOST`. It also rejects values that still look like template placeholders.

---

## Security model

**Passwords and credentials**
Passwords are hashed with argon2id and never logged or returned by any endpoint. A
strength policy is enforced server-side and mirrored in the UI. The account registry
deliberately has no field for an external password — the system never asks for one.

**Sessions**
Access and refresh tokens travel in `httpOnly` cookies (`dg_access`, `dg_refresh`) so
script cannot read them. Access tokens live 5 minutes; refresh tokens 30 days and are
**rotated on every use**. Presenting an already-rotated token is treated as theft: the
whole token family is revoked and the event is recorded. Revocations carry an explicit
reason — `logged_out`, `password_changed`, `mfa_changed`, `manual`, `reuse_detected`,
`expired`, `all_other_sessions`, `rotated`.

**Two-step verification**
A password-only login is recorded as password-only; `mfa_verified` is set only when a
second factor was actually proven. While a code is outstanding the session is
provisional, gets a short TTL, and is issued no token. Confirming setup stores ten
one-time recovery codes as hashes, drawn from an alphabet with no `I`, `O`, `0` or `1` so
they survive being read aloud, then notifies you, records the event and re-scores the
account. Existing sessions are not silently dropped — you revoke them yourself from the
sessions screen when you want to.

**Cross-site request forgery**
Every unsafe method under `/api` must carry the `x-csrf-token` header matching the
`dg_csrf` cookie, on top of `requireAuth`.

**Rate limiting and lockout**
Auth endpoints allow `AUTH_RATE_LIMIT_MAX` attempts per window per IP (default 20/15 min),
the analyzer has its own stricter budget, and every protected route passes a general
limiter. Repeated bad passwords lock the account. Failed attempts are recorded without
storing the password or a full IP — addresses are hashed.

**Transport and headers**
`helmet` secures responses (framing denied, no-referrer; the CSP belongs to the frontend
deployment because this service only answers JSON), and CORS uses an exact origin
allowlist with credentials enabled — never a wildcard. `app.set('trust proxy', 1)` makes
client IPs and therefore rate limits meaningful behind Render.

**Data access**
Every query is parameterized SQL through one pool. Input is validated at the route
boundary with zod schemas. A single error handler maps failures to safe, human messages
and never leaks a stack trace or a constraint name to the browser.

**What the system honestly cannot see**
It has no integration with Google, Facebook, banks or any other provider, and does not
pretend otherwise. The analyzer never contacts the link you paste — it inspects the URL
and message text offline, so checking a suspicious target cannot reveal your address or
confirm the site is live. It does not track location: sessions show the browser and
operating system your own device reported, the IP is stored only as a hash, and your
timezone is a preference you set. A clean score is a summary of what you told
Digital Guardian, not a guarantee of safety.

---

## The Digital Safety Score

Nine weighted factors, summing to exactly 100:

| Factor | Weight |
| --- | --- |
| Two-step coverage across your important accounts | 20 |
| Two-step on the account itself and its email | 15 |
| Recovery readiness (codes stored, details current) | 12 |
| Alert hygiene (did you look at what we told you) | 10 |
| Privacy checklist progress | 10 |
| Incident hygiene | 10 |
| Review freshness (how stale your account reviews are) | 8 |
| Risk exposure from analyzer findings | 8 |
| Learning progress | 7 |

Each factor returns earned points, its weight, and a sentence explaining the result. A
check that cannot apply to you yet is marked `not_applicable` and its weight is
**renormalised across the remaining factors** rather than silently counted as zero, so an
incomplete profile is not punished with a fake low score. Nothing is random: the number
moves only when evidence moves.

Bands: `critical` < 35, `at_risk` 35–54, `fair` 55–74, `protected` 75–89, `strong` ≥ 90.
Every recalculation is stored with its trigger — `signup`, `account_created`,
`account_updated`, `review_logged`, `checklist_updated`, `learning_completed`,
`recommendation_updated`, `incident_updated`, `alerts_reviewed`, `analysis_run`,
`mfa_updated`, `manual`, `periodic` — and the history screen names them in plain words.

---

## API routes

`/health` proves the process is alive; `/health/ready` also connects to the database and
returns 503 when it cannot. `/api` lists the route groups.

| Group | Endpoints |
| --- | --- |
| `/api/auth` | `POST register`, `POST login`, `POST login/mfa`, `POST refresh`, `GET me`, `POST logout`, `POST verify-email`, `POST resend-verification`, `POST forgot-password`, `POST reset-password`, `GET policy` |
| `/api/dashboard` | `GET dashboard` |
| `/api/score` | `GET score`, `GET score/history`, `POST score/recalculate` |
| `/api/recommendations` | `GET recommendations`, `PATCH recommendations/:id` |
| `/api/accounts` | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `POST /:id/review`, `DELETE /:id`, `GET /meta/options` |
| `/api/analyze` | `POST analyze`, `GET analyses`, `GET analyses/:id`, `POST reports`, `GET reports`, `GET reports/:id` |
| `/api/notifications` | `GET /`, `GET /unread-count`, `POST /:id/read`, `POST /read-all`, `POST /:id/archive` |
| `/api/events` | `GET /` |
| `/api/settings` | `GET/PUT profile`, `PUT preferences`, `PUT password`, `POST mfa/setup`, `POST mfa/enable`, `POST mfa/disable`, `POST mfa/recovery-codes`, `GET sessions`, `GET sessions/summary`, `DELETE sessions/:id`, `POST sessions/revoke-others` |

Everything except `/api/auth` login-side endpoints requires a session, and every
state-changing request also needs the CSRF header.

---

## Database

31 tables across seven checksummed migrations: identity and sessions, assets and
scoring, analysis and incidents, learning, notifications and settings, then two that
widen constraints rather than editing applied history.

The runner records a checksum per migration and **detects drift**: change an applied file
and it stops with an explicit error instead of quietly diverging. Add a new migration
instead. At boot the API also refuses to start when migrations are pending, so a deploy
can never serve a schema older than its own code.

---

## Testing and verification

60 tests across three files, run against a real PostgreSQL instance rather than mocks:

- `scoring.test.ts` — the score is deterministic, stays inside 0–100 for every shape of
  account, marks a factor `not_applicable` and renormalises instead of guessing, moves only
  when real protection is added, and explains every factor in plain language with somewhere
  to act; also covers recommendation ordering
- `analyzer.engine.test.ts` — host parsing and public suffixes, look-alike and
  brand-impersonation detection, IP literals, shorteners, credential and one-time-code
  requests, ordinary messages left alone, and that only the four promised verdict words appear
- `api.integration.test.ts` — 37 end-to-end requests against a real database: health and
  readiness probes, security headers and origin reflection, body-size and input validation,
  password policy, registration and mailed verification, duplicate and non-revealing email
  handling, httpOnly cookies plus the CSRF proof, refresh rotation with family revocation on
  replay, lockout after repeated failures, MFA enrolment and single-use recovery codes,
  honest session labelling, score movement only on real protection, analyzer verdicts with
  reasons, per-user data isolation, reporting, sessions, alert review, password change
  signing other devices out, and notification preferences

```bash
npm run test        # or npm run verify for typecheck + tests + both builds
```

`npm run verify` is the commit gate: it fails loudly if any step fails.

---

## Deployment

Hosting is fixed by the specification: client on Vercel, API on Render, PostgreSQL on
Supabase. `vercel.json` and `render.yaml` are committed, so the build settings and the
*names* of every required variable are reviewable in git; the values are entered only in
each provider's dashboard.

### 1. Supabase

Create a project, then take the **session-mode pooler** connection string (port **5432**).
Do not use the transaction pooler on 6543: `runMigrations()` takes a session-scoped
`pg_advisory_lock` and releases it at the end, and transaction pooling can route those two
statements to different backends, leaving the lock held. This application has no Prisma,
so there is no `DIRECT_URL` — one `DATABASE_URL`, pointing at 5432, is correct for both
migrations and runtime. Add `?sslmode=require` and set `PGSSL=true`.

Do not enable Row Level Security on these tables and do not use Supabase Auth, its keys,
or its client libraries: the API is the only client and RLS would filter its own rows.

Apply the schema from your machine, with the connection string supplied by the shell so
it never lands in a committed file:

```bash
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
PGSSL=true npm run migrate --workspace server
```

### 2. Render

Create a **Web Service** from this repository. The Blueprint in `render.yaml` supplies
everything except secrets, which are marked `sync: false` and must be entered in the
dashboard:

- Build: `npm ci --include=dev && npm run build --workspace server` — Render sets
  `NODE_ENV=production`, which would otherwise skip the dev dependencies that `tsc` needs
- Start: `node server/dist/index.js`
- Health check path: `/health/ready`
- `CORS_ORIGINS` and `APP_CLIENT_URL`: your Vercel origin, `https://`, no trailing slash
- `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none`, and **leave `COOKIE_DOMAIN` unset**
- `SMTP_*`: real credentials — the API will not boot in production without `SMTP_HOST`
- Do not set `PORT`; Render provides it and `trust proxy` is already configured

Free instances sleep, so the first request after idling takes tens of seconds and the
client will show its error state. That is the cold start, not a bug.

### 3. Vercel

Import the repository. `vercel.json` sets the workspace build command, the
`client/dist` output, an SPA rewrite so deep links like `/score` and `/reset-password`
resolve, and safe response headers.

Set `VITE_API_BASE_URL` to the Render origin. This value is **inlined at build time**, so
changing it in the dashboard does nothing until you redeploy. Vercel preview deployments
get random URLs that are not in `CORS_ORIGINS`, so previews load but cannot sign in —
either pin one preview origin into `CORS_ORIGINS` or test on production.

### 4. The cookie decision

`*.vercel.app` and `*.onrender.com` are different sites, which forces
`SameSite=None; Secure`. If you point both at one registrable domain
(`guardian.example.com` and `api.example.com`), they are the same site again and
`SameSite=Lax` works, which browsers treat more favourably than cross-site cookies.

### 5. After deploying

Walk the real flow on the live URLs: register → verify by email → sign in → enable
two-step → check a link → review the score → sign out → sign back in → request a
password reset. Registration alone exercises the database, mail delivery, cookies and
CSRF at once.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Database schema is behind the code` at boot | Pending migrations. Run `npm run migrate`. |
| `Migration 000X changed after it was applied` | An applied file was edited. Revert it and add a new migration. |
| `COOKIE_SAME_SITE=none requires COOKIE_SECURE=true` | Browsers reject that combination; set `COOKIE_SECURE=true`. |
| `CORS_ORIGINS contains a development URL` | Production refuses localhost origins; list the real HTTPS origin. |
| `SMTP_HOST is required in production` | Password resets would be silently swallowed; configure mail. |
| `<KEY> still looks like a placeholder value` | A template value survived into the environment; set the real one. |
| Sign-in works locally but not on the deployment | `CORS_ORIGINS` mismatch, `COOKIE_DOMAIN` set, or `VITE_API_BASE_URL` changed without redeploying. |
| Migrations hang against Supabase | You used the 6543 transaction pooler; switch to the 5432 session pooler. |
| `Invalid username or token` on `git push` | GitHub needs an interactive sign-in; run the push from your own terminal. |

---

## Accessibility and UX commitments

Dark and light themes, with the preference stored on the account so it follows you
between devices. Full keyboard navigation with visible focus states, labelled controls,
and a skip link. Severity is always carried by an icon **and** a word, never colour
alone. Every screen has loading skeletons, an empty state with a next action, and an
error state that says what failed. Destructive actions ask for confirmation. The footer
states plainly that a clean result is not a guarantee of safety.

---

## Roadmap

Phase 2 builds the screens whose tables already exist: the privacy and digital-footprint
centre, incident reporting with a timeline, Emergency Response Mode, the learning hub, and
the admin security centre with role-based access enforced on **both** the router and the
API endpoints — hiding a button is never the authorization.

## Licence

Coursework submitted for a systems engineering capstone. No licence file has been chosen
yet; ask before reusing this code elsewhere.
