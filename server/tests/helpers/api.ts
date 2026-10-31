import fs from 'node:fs'
import path from 'node:path'
import supertest from 'supertest'
import type { Response } from 'supertest'
import type { Express } from 'express'

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

export type CallOptions = {
  body?: string | object
  /** Send the double-submit CSRF header. Defaults to on for unsafe methods. */
  csrf?: boolean
  headers?: Record<string, string>
}

/**
 * A browser-like caller: it keeps the httpOnly cookies the API sets, replays the
 * CSRF token it was handed in the login body, and can present a bearer token for
 * the flows where the client is not a same-browser page.
 */
export class Api {
  private readonly jar = new Map<string, string>()
  csrfToken: string | undefined
  bearer: string | undefined

  constructor(private readonly app: Express) {}

  get cookieHeader(): string {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  cookieValue(name: string): string | undefined {
    return this.jar.get(name)
  }

  signedOut(): boolean {
    return this.jar.size === 0
  }

  private absorb(res: Response): void {
    const raw = res.headers['set-cookie'] as unknown
    const lines = (Array.isArray(raw) ? raw : [raw]).filter((line): line is string => typeof line === 'string')
    for (const line of lines) {
      const [pair] = line.split(';')
      if (!pair) continue
      const separator = pair.indexOf('=')
      if (separator < 1) continue
      const name = pair.slice(0, separator).trim()
      const value = pair.slice(separator + 1).trim()
      if (value.length === 0) this.jar.delete(name)
      else this.jar.set(name, value)
    }

    const body = res.body as { csrfToken?: unknown } | undefined
    if (body && typeof body.csrfToken === 'string') this.csrfToken = body.csrfToken
  }

  async call(method: Method, url: string, options: CallOptions = {}): Promise<Response> {
    let test = supertest(this.app)[method](url)
    test = test.set('Accept', 'application/json').set('User-Agent', 'Digital Guardian Test (Chrome on Windows)')

    const cookies = this.cookieHeader
    if (cookies) test = test.set('Cookie', cookies)
    if (options.headers) {
      for (const [name, value] of Object.entries(options.headers)) test = test.set(name, value)
    }
    if (this.bearer && !options.headers?.Authorization) test = test.set('Authorization', `Bearer ${this.bearer}`)

    const unsafe = method !== 'get'
    const wantsCsrf = options.csrf ?? unsafe
    const explicitCsrf = options.headers?.['x-csrf-token']
    if (wantsCsrf && this.csrfToken && !explicitCsrf) test = test.set('x-csrf-token', this.csrfToken)

    if (options.body !== undefined) test = test.send(options.body)

    const res = await test
    this.absorb(res)
    return res
  }

  get(url: string, options?: CallOptions) {
    return this.call('get', url, options)
  }

  post(url: string, body?: string | object, options?: CallOptions) {
    return this.call('post', url, { ...options, body })
  }

  put(url: string, body?: string | object, options?: CallOptions) {
    return this.call('put', url, { ...options, body })
  }

  patch(url: string, body?: string | object, options?: CallOptions) {
    return this.call('patch', url, { ...options, body })
  }

  del(url: string, options?: CallOptions) {
    return this.call('delete', url, options)
  }

  /**
   * Reads the newest message the API wrote to the local outbox (used because no
   * SMTP server exists in tests) and removes it so the next read is unambiguous.
   */
  static readOutboxMessage(serverRoot: string, to: string, subjectIncludes = ''): { text: string; file: string } | null {
    const dir = path.join(serverRoot, '.outbox')
    if (!fs.existsSync(dir)) return null
    const files = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.txt'))
      .sort()
      .reverse()
    for (const file of files) {
      const full = path.join(dir, file)
      const text = fs.readFileSync(full, 'utf8')
      if (!text.startsWith(`To: ${to}\n`)) continue
      if (subjectIncludes && !text.includes(subjectIncludes)) continue
      fs.rmSync(full, { force: true })
      return { text, file: full }
    }
    return null
  }
}

export function tokenFromLink(text: string, parameter = 'token'): string {
  const match = text.match(new RegExp(`${parameter}=([A-Za-z0-9._~-]{20,})`))
  if (!match?.[1]) throw new Error(`No ${parameter} found in the outbox message.`)
  return match[1]
}
