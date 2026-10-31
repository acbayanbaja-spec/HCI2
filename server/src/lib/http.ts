import type { Request } from 'express'
import { parse } from 'cookie'

/**
 * Best-effort client address. Render and Vercel terminate TLS in front of the
 * app, so `trust proxy` is enabled and req.ip already reflects the X-Forwarded-For
 * chain. Only ever hashed before storage - never kept in the clear.
 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

export function readCookie(req: Request, name: string): string | null {
  if (!req.headers.cookie) return null
  return parse(req.headers.cookie)[name] ?? null
}

export type DeviceInfo = { browser: string; os: string; platform: string; label: string }

/**
 * Deliberately small: enough to label a session ("Chrome on Windows") without
 * pulling in a user-agent parsing dataset.
 */
export function describeUserAgent(userAgent: string | undefined): DeviceInfo {
  const ua = userAgent ?? ''
  const browser = /Edg\/([\d.]+)/.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/([\d.]+)/.test(ua)
        ? 'Firefox'
        : /Chrome\/([\d.]+)/.test(ua)
          ? 'Chrome'
          : /Safari\/([\d.]+)/.test(ua)
            ? 'Safari'
            : ua
              ? 'Unknown browser'
              : 'Unknown device'

  const os = /Windows NT 11/.test(ua) || /Windows NT 10/.test(ua)
    ? 'Windows'
    : /Windows Phone/.test(ua)
      ? 'Windows Phone'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iPod/.test(ua)
          ? 'iOS'
          : /Mac OS X/.test(ua)
            ? 'macOS'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'Unknown OS'

  const platform = /Mobile|Android|iPhone|iPad|iPod|Windows Phone/.test(ua) ? 'mobile' : 'desktop'
  return { browser, os, platform, label: `${browser} on ${os}` }
}

export function userAgentHeader(req: Request): string {
  const header = req.headers['user-agent']
  return (typeof header === 'string' ? header : '').slice(0, 300)
}
