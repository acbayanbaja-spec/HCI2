import { describe, expect, it } from 'vitest'
import {
  analyzeInput,
  registrableDomain,
  verdictLabel,
} from '../src/services/analyzer.engine'

/**
 * The engine is a heuristic, so the tests that matter are the ones that pin
 * down what it must never do: call a real service dangerous, or wave through a
 * look-alike built from number-for-letter swaps.
 */
describe('registrable domain extraction', () => {
  it('takes the last two labels for a normal host', () => {
    expect(registrableDomain('login.secure.paypal.com')).toBe('paypal.com')
  })

  it('honours a two-level public suffix', () => {
    expect(registrableDomain('alerts.google.com.ph')).toBe('google.com.ph')
  })
})

describe('url analysis', () => {
  it('flags a leetspeak brand look-alike as high risk', () => {
    const result = analyzeInput('https://paypa1-secure-login.com/account/update', 'url')
    expect(result.verdict).toBe('high')
    expect(result.indicators.map((i) => i.code)).toContain('typosquat')
  })

  it('does not flag the brand owning its own domain', () => {
    const result = analyzeInput('https://www.paypal.com/myaccount/summary', 'url')
    expect(result.riskScore).toBeLessThan(30)
    expect(result.indicators.map((i) => i.code)).not.toContain('brand_in_wrong_place')
  })

  it('accepts a country-suffixed domain the brand really owns', () => {
    const result = analyzeInput('https://www.google.com.ph/search?q=cash', 'url')
    expect(result.indicators.map((i) => i.code)).not.toContain('typosquat')
  })

  it('names an IP literal address as high risk', () => {
    const result = analyzeInput('http://192.168.10.5/login?next=reset', 'url')
    expect(result.indicators.map((i) => i.code)).toContain('ip_literal')
  })

  it('explains that a shortener hides the real destination', () => {
    const result = analyzeInput('https://bit.ly/3xAbC', 'url')
    expect(result.indicators.map((i) => i.code)).toContain('shortened_link')
  })

  it('leaves an ordinary bank address alone', () => {
    const result = analyzeInput('https://mybank.com', 'url')
    expect(result.verdict).toBe('low')
  })
})

describe('message analysis', () => {
  it('connects a brand name in the text to a link it does not own', () => {
    const result = analyzeInput(
      'Hi, this is GCash support. Your wallet will be frozen in 24 hours. Verify your account now at http://gcash-verify.top/acc',
      'message',
    )
    expect(['suspicious', 'high']).toContain(result.verdict)
    const codes = result.indicators.map((i) => i.code)
    expect(codes).toContain('brand_impersonation')
    expect(codes).toContain('urgency')
  })

  it('does not raise an alarm on an ordinary message', () => {
    const result = analyzeInput('Hey, are we still on for lunch tomorrow at noon?', 'message')
    expect(result.verdict).toBe('low')
    expect(result.riskScore).toBeLessThan(30)
  })

  it('flags a request for a password or code', () => {
    const result = analyzeInput(
      'Hello, this is your bank. Please reply with your account password and the SMS code you received so we can verify you.',
      'email',
    )
    expect(result.indicators.map((i) => i.code)).toContain('asks_for_secret')
  })
})

describe('verdict labels', () => {
  it('uses the four words the interface promises', () => {
    expect(verdictLabel('low')).toBe('LOW RISK')
    expect(verdictLabel('caution')).toBe('BE CAREFUL')
    expect(verdictLabel('suspicious')).toBe('SUSPICIOUS')
    expect(verdictLabel('high')).toBe('HIGH RISK')
  })
})
