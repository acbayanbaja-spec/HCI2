export type DatabaseTarget = {
  user: string
  host: string
  port: string
  database: string
  pooler: boolean
  rewrittenUser: boolean
}

export type NormalizedDatabaseUrl = {
  url: string
  target: DatabaseTarget
}

function stripWrap(raw: string): string {
  let value = raw.trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim()
  }
  return value
}

function decodeOnce(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function splitHostPort(hostport: string): { host: string; port: string } {
  if (hostport.startsWith('[')) {
    const end = hostport.indexOf(']')
    if (end === -1) return { host: hostport, port: '5432' }
    return { host: hostport.slice(0, end + 1), port: hostport.slice(end + 2) || '5432' }
  }
  const index = hostport.lastIndexOf(':')
  if (index === -1) return { host: hostport, port: '5432' }
  return { host: hostport.slice(0, index), port: hostport.slice(index + 1) || '5432' }
}

function projectRefFromUser(user: string): string | undefined {
  if (user.startsWith('postgres.') && user.length > 'postgres.'.length) {
    return user.slice('postgres.'.length)
  }
  return undefined
}

function projectRefFromHost(host: string): string | undefined {
  const match = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)
  return match?.[1]
}

/**
 * Render dashboards and copy-paste from Supabase regularly produce a string
 * that TLS will accept and then fail with "password authentication failed for
 * user postgres": the session pooler needs `postgres.<project-ref>`, and any
 * `@ : / # ?` in the password has to be percent-encoded.
 */
export function normalizeDatabaseUrl(
  raw: string,
  options: { projectRef?: string } = {},
): NormalizedDatabaseUrl {
  const original = stripWrap(raw)
  const match = original.match(/^(postgres(?:ql)?):\/\/(.+)@([^/?]+)(\/[^?]*)?(\?.*)?$/i)
  if (!match) {
    throw new Error(
      'DATABASE_URL is not a PostgreSQL connection string. Expected postgresql://user:password@host:port/database.',
    )
  }

  const [, protocolRaw = 'postgresql', userinfo = '', hostport = '', pathRaw, queryRaw] = match
  const protocol = protocolRaw.toLowerCase() === 'postgres' ? 'postgresql' : protocolRaw
  const pathPart = pathRaw ?? '/postgres'
  const query = queryRaw ?? ''

  const colon = userinfo.indexOf(':')
  let user = decodeOnce(colon === -1 ? userinfo : userinfo.slice(0, colon))
  const password = decodeOnce(colon === -1 ? '' : userinfo.slice(colon + 1))
  const { host, port: parsedPort } = splitHostPort(hostport)
  let port = parsedPort
  const database = decodeOnce((pathPart.replace(/^\//, '').split('/')[0] || 'postgres').split('#')[0] ?? 'postgres')
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)

  const pooler = /\.pooler\.supabase\.com$/i.test(host)
  const suppliedRef = options.projectRef?.trim() || undefined
  const ref =
    projectRefFromUser(user) ||
    suppliedRef ||
    projectRefFromHost(host) ||
    params.get('supabase_project_ref') ||
    params.get('project') ||
    undefined

  let rewrittenUser = false
  if (pooler && user === 'postgres') {
    if (!ref) {
      throw new Error(
        'DATABASE_URL points at the Supabase pooler as user "postgres". Copy the Session pooler URI (port 5432) from Supabase → Connect, which uses postgres.<project-ref> as the username, or set SUPABASE_PROJECT_REF on Render.',
      )
    }
    user = `postgres.${ref}`
    rewrittenUser = true
  }

  // Same hostname as session mode; only the port differs. Render/Supabase copy-paste
  // often lands on 6543 (transaction), which cannot hold pg_advisory_lock across
  // migrate + release. Rewrite instead of crashing the process on boot.
  if (pooler && port === '6543') {
    port = '5432'
  }

  if (!user) {
    throw new Error('DATABASE_URL is missing a username.')
  }

  const encodedQuery = params.toString()
  const url = `${protocol}://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}${
    encodedQuery ? `?${encodedQuery}` : ''
  }`

  return {
    url,
    target: { user, host, port, database, pooler, rewrittenUser },
  }
}

export function explainDatabaseError(error: unknown, target?: DatabaseTarget): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/password authentication failed/i.test(message)) {
    const user = target?.user ?? 'unknown'
    const host = target?.host ?? 'unknown'
    const poolerHint = target?.pooler
      ? ' The session pooler username must be postgres.<project-ref>, not postgres. Copy it from Supabase → Connect → Session pooler (port 5432).'
      : ''
    const encodingHint =
      ' If the database password contains @ : / # or ?, percent-encode those characters in DATABASE_URL.'
    return new Error(
      `Database authentication failed for user "${user}" at ${host}.${poolerHint}${encodingHint} Confirm the database password in the Render dashboard matches the one in Supabase → Settings → Database.`,
    )
  }
  return error instanceof Error ? error : new Error(message)
}
