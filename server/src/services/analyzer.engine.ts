export type IndicatorSeverity = 'info' | 'caution' | 'warning' | 'critical'

export type Indicator = {
  code: string
  label: string
  severity: IndicatorSeverity
  detail: string
  advice: string
  weight: number
}

export type Verdict = 'low' | 'caution' | 'suspicious' | 'high'

export type AnalysisResult = {
  verdict: Verdict
  riskScore: number
  indicators: Indicator[]
  guidance: string[]
  linksFound: string[]
  engineVersion: number
}

export const ANALYZER_VERSION = 1

/**
 * Brands the detector watches for look-alikes. Philippine services are included
 * because that is where this system's users actually get phished.
 */
const KNOWN_BRANDS = [
  'google',
  'gmail',
  'microsoft',
  'outlook',
  'facebook',
  'meta',
  'instagram',
  'apple',
  'icloud',
  'amazon',
  'paypal',
  'netflix',
  'linkedin',
  'gcash',
  'maya',
  'shopee',
  'lazada',
  'bdo',
  'bpi',
  'landbank',
  'unionbank',
  'metrobank',
  'citibank',
  'pldt',
  'globe',
  'smart',
  'tiktok',
  'whatsapp',
  'telegram',
  'Grab',
  'foodpanda',
  'philhealth',
  'sss',
  'pagibig',
  'commissiononvoting',
  'comelec',
].map((brand) => brand.toLowerCase())

const SUSPICIOUS_TLDS = new Set([
  'zip',
  'mov',
  'tk',
  'ml',
  'ga',
  'cf',
  'gq',
  'xyz',
  'top',
  'click',
  'link',
  'work',
  'loan',
  'date',
  'download',
  'stream',
  'win',
  'bid',
  'rest',
  'shop',
  'buzz',
])

const COUNTRY_CODE_TLDS = ['ph', 'uk', 'au', 'jp', 'sg', 'my', 'br', 'in', 'za', 'nz', 'hk', 'id', 'th', 'kr', 'mx', 'ar', 'co']
const SECOND_LEVEL_LABELS = ['com', 'net', 'org', 'gov', 'edu', 'co']

const URL_SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'is.gd',
  'cutt.ly',
  'rb.gy',
  'ow.ly',
  'shorturl.at',
  'rebrand.ly',
  'cli.gs',
  'goo.gl',
  'buff.ly',
  'linktr.ee',
])

const CREDENTIAL_WORDS = ['password', 'pin', 'cvv', 'otp', 'one-time code', 'verification code', 'secret question']
const URGENCY_WORDS = [
  'immediately',
  'right now',
  'act now',
  'within 24 hours',
  'within 24 hrs',
  'expires today',
  'will be suspended',
  'will be closed',
  'permanently deleted',
  'last warning',
  'final notice',
  'urgent action required',
  'unusual activity',
  'suspicious sign-in',
  'unauthorized login',
  'verify your account',
  'confirm your account',
  'validate your account',
  'unlock your account',
  'your payment failed',
  'delivery failed',
  'package cannot be delivered',
]
const REWARD_WORDS = [
  'you have been selected',
  'you are a winner',
  'claim your prize',
  'claim now',
  'free iphone',
  'cash bonus',
  'double your money',
  'gift card',
  'crypto giveaway',
  'airtime reload',
  'load free',
  'refund of',
  'lucky draw',
]

/**
 * Small Levenshtein implementation - only ever used on short domain labels, so
 * the quadratic form is fine and keeps a fuzzy-matching dependency out.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost)
    }
    previous = current
  }
  return previous[b.length]!
}

const LEET_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
}

function deobfuscate(label: string): string {
  return label.toLowerCase().replace(/[0134578@$]/g, (char) => LEET_MAP[char] ?? char).replace(/rn/g, 'm')
}

function stripExtensions(label: string): string {
  return label.replace(/[-_.]?(?:login|signin|secure|verify|account|app|portal|help|support|service|id|net|online)\b/gi, '')
}

/** Last two labels, honouring two-level public suffixes like com.ph and co.uk. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const penultimate = labels[labels.length - 2]!
  const last = labels[labels.length - 1]!
  if (labels.length >= 3 && last.length === 2 && COUNTRY_CODE_TLDS.includes(last) && SECOND_LEVEL_LABELS.includes(penultimate)) {
    return labels.slice(-3).join('.')
  }
  return `${penultimate}.${last}`
}

export function domainLabel(host: string): string {
  const registrable = registrableDomain(host)
  return registrable.split('.')[0] ?? registrable
}

function indicator(
  code: string,
  label: string,
  severity: IndicatorSeverity,
  detail: string,
  advice: string,
  weight: number,
): Indicator {
  return { code, label, severity, detail, advice, weight }
}

const SEVERITY_WEIGHT: Record<IndicatorSeverity, number> = { info: 0, caution: 1, warning: 2, critical: 3 }

/** Signals that only happen when somebody is pretending to be a real service. */
const IMPERSONATION_CODES = new Set(['typosquat', 'brand_in_wrong_place', 'brand_impersonation', 'punycode', 'mixed_script'])
const HIGH_RISK_FLOOR = 80

function verdictFor(score: number): Verdict {
  if (score >= 80) return 'high'
  if (score >= 55) return 'suspicious'
  if (score >= 30) return 'caution'
  return 'low'
}

const VERDICT_LABELS: Record<Verdict, string> = {
  low: 'LOW RISK',
  caution: 'BE CAREFUL',
  suspicious: 'SUSPICIOUS',
  high: 'HIGH RISK',
}

export function verdictLabel(verdict: Verdict): string {
  return VERDICT_LABELS[verdict]
}

export function extractLinks(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s<>"'`)\]}]+/gi) ?? []
  const bare = text.match(/\b(?:xn--[\w-]+\.)|(?:[\w-]+\.)+(?:com|net|org|xyz|top|shop|online|site|live|click|link|tk|ml|ga|ph|co|io)\b[\/\w.?#=&%-]*/gi) ?? []
  return Array.from(new Set([...urls, ...bare].map((value) => value.trim().replace(/[.,;!?]+$/, '')))).slice(0, 10)
}

/**
 * Every rule here is a *signal*, not a verdict of malware. The explanations name
 * the matched pattern so a user can see exactly why something was flagged.
 */
export function analyzeUrl(rawUrl: string): Indicator[] {
  const indicators: Indicator[] = []
  const trimmed = rawUrl.trim()
  if (!trimmed) return indicators

  const dangerousScheme = /^(javascript|data|file|vbscript|gopher):/i.exec(trimmed)
  if (dangerousScheme) {
    indicators.push(
      indicator(
        'dangerous_scheme',
        'Link type that can run code',
        'critical',
        `This starts with "${dangerousScheme[1]}:" instead of a normal web address. Those forms can carry instructions to your browser rather than opening a page.`,
        'Do not tap or click it. If you pasted it from somewhere, delete that copy.',
        45,
      ),
    )
    return indicators
  }

  let url: URL
  try {
    url = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed)
  } catch {
    indicators.push(
      indicator(
        'malformed_url',
        'Cannot be read as a web address',
        'caution',
        'This is not a well-formed link, so its real destination cannot be confirmed.',
        'Type the address of the service yourself instead of using the link.',
        10,
      ),
    )
    return indicators
  }

  const host = url.hostname.toLowerCase()
  const pathAndQuery = `${url.pathname}${url.search}`.toLowerCase()

  if (!host) {
    indicators.push(
      indicator('no_host', 'No website name found', 'warning', 'There is no readable website name in this link.', 'Do not open it.', 25),
    )
    return indicators
  }

  if (url.protocol !== 'https:') {
    indicators.push(
      indicator(
        'insecure_protocol',
        'Not an encrypted address',
        'caution',
        'The link uses http://, so anything you type on that page can be read by someone else on the same network.',
        'Only continue on a network you control, and never enter a password on an http page.',
        12,
      ),
    )
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\[?[0-9a-f:]+\]?$/.test(host)) {
    indicators.push(
      indicator(
        'ip_literal',
        'Address written as a raw number',
        'warning',
        'Legitimate services almost always use a name, not a bare numeric address like this one.',
        'Treat this as untrusted unless you were explicitly told to use that number.',
        30,
      ),
    )
  }

  if (url.username || url.password) {
    indicators.push(
      indicator(
        'userinfo',
        'Credentials hidden inside the link',
        'critical',
        'Text before the @ in a link is read as part of the address, not the destination. This is a classic trick for making a link look like a site it is not.',
        'Do not open it. The real destination is the part after the last @.',
        40,
      ),
    )
  }

  if (trimmed.length > 2000) {
    indicators.push(
      indicator('excessive_length', 'Unusually long link', 'caution', 'Length this great usually hides what the destination really is.', 'Do not open it from a message you did not expect.', 8),
    )
  }

  const labels = host.split('.').filter(Boolean)
  if (labels.length > 5) {
    indicators.push(
      indicator(
        'deep_subdomains',
        'Many name layers',
        'warning',
        `There are ${labels.length} layers before the site name. Only the last two are the real address; the rest can be anything.`,
        `Read the address from the right: the site it truly belongs to is ${registrableDomain(host)}.`,
        20,
      ),
    )
  }

  if (host.includes('xn--')) {
    indicators.push(
      indicator(
        'punycode',
        'Name written in look-alike characters',
        'critical',
        'This address uses encoded characters that can render as familiar letters. Attackers copy brand names this way.',
        'Do not open it. Confirm the address with the company through their official site.',
        45,
      ),
    )
  } else if (/[^\x00-\x7f]/.test(host) && /[a-z]/i.test(host)) {
    indicators.push(
      indicator(
        'mixed_script',
        'Name mixes character sets',
        'critical',
        'Some letters in this address are not the keyboard characters they resemble, which is how a fake brand name looks real.',
        'Do not open it.',
        42,
      ),
    )
  }

  const registrable = registrableDomain(host)
  const baseLabel = domainLabel(host)
  const cleaned = stripExtensions(baseLabel)
  const normalized = deobfuscate(cleaned)
  const normalizedHost = deobfuscate(host)
  const tld = labels[labels.length - 1]!

  for (const brand of KNOWN_BRANDS) {
    if (brand.length < 4) continue
    // The label that owns the registered domain, not a string inside it.
    // "google.com.ph" is Google's; "ph-google.security" is not.
    if (baseLabel === brand) continue

    // "paypa1-secure-login.com" is the same attack as "paypaI.com": a brand
    // appears in the address, but the part that controls the site is somebody
    // else's. Checking the deobfuscated form catches the number-for-letter
    // swaps that a plain spelling comparison sails straight past.
    if (host.includes(brand) || normalizedHost.includes(brand)) {
      const exactLookAlike = normalized === brand || cleaned === brand
      indicators.push(
        indicator(
          exactLookAlike ? 'typosquat' : 'brand_in_wrong_place',
          exactLookAlike ? `Look-alike of ${brand}` : `Name uses "${brand}" without owning it`,
          'critical',
          exactLookAlike
            ? `"${baseLabel}" is "${brand}" with characters swapped. 0 for o, 1 for l and rn for m are the usual tricks.`
            : `The address only looks like ${brand}. The part that actually controls the site is ${registrable}.`,
          `Do not enter anything here. Open ${brand} from your own app or by typing its address, and check for real notices there.`,
          45,
        ),
      )
      break
    }

    const pieces = [normalized, ...normalized.split(/[^a-z]+/).filter((piece) => piece.length >= 4)]
    const distance = Math.min(...pieces.map((piece) => editDistance(piece, brand)))
    const lookalike =
      (distance === 1 && Math.max(normalized.length, brand.length) >= 5) ||
      (distance === 2 && normalized.length >= 8 && normalized.includes(brand.slice(0, 3)))

    if (lookalike) {
      indicators.push(
        indicator(
          'typosquat',
          `Look-alike of ${brand}`,
          'critical',
          `"${baseLabel}" is one or two characters away from "${brand}". Substitutions like 0 for o, 1 for l and rn for m are used to imitate real names.`,
          `Do not enter anything there. If you already did, change your ${brand} password from the real site now.`,
          40,
        ),
      )
      break
    }
  }

  if (SUSPICIOUS_TLDS.has(tld) && !host.includes('xn--')) {
    indicators.push(
      indicator(
        'cheap_tld',
        `Registered under .${tld}`,
        'caution',
        `.${tld} addresses are heavily used in scams because they are cheap or free to obtain.`,
        'Weigh this against what the page is asking you to do.',
        10,
      ),
    )
  }

  if ((host.match(/-/g) ?? []).length >= 3) {
    indicators.push(
      indicator('hyphen_heavy', 'Name stacked with hyphens', 'caution', 'Several hyphens in one site name is typical of throwaway scam addresses.', 'Check the spelling of the address carefully.', 8),
    )
  }

  if (/[0-9]{3,}/.test(baseLabel) && !/^(?:19|20)[0-9]{2}$/.test(baseLabel)) {
    indicators.push(
      indicator('digits_in_name', 'Numbers inside the site name', 'caution', `"${baseLabel}" mixes numbers into what should be a brand name.`, 'Compare it with the official address.', 10),
    )
  }

  if (URL_SHORTENERS.has(registrable)) {
    indicators.push(
      indicator(
        'shortened_link',
        'Hidden behind a link shortener',
        'caution',
        `A shortener such as ${registrable} hides the real destination, so you cannot judge it before tapping.`,
        'Open it only where you can see where it lands, or ask the sender for the full address.',
        14,
      ),
    )
  }

  if (url.port && url.port !== '443' && url.port !== '80') {
    indicators.push(
      indicator('odd_port', `Unusual port ${url.port}`, 'caution', 'Most websites do not need a port number written into the address.', 'Only continue if you know why the port is there.', 12),
    )
  }

  if (/\/(?:login|signin|sign-in|verify|verification|confirm|secure|update|reset|password|wallet|billing|auth|account)\b/.test(pathAndQuery)) {
    indicators.push(
      indicator(
        'credential_path',
        'Page asks you to sign in or verify',
        'warning',
        'The address leads straight to a sign-in or verification page, which is what a fake site needs from you.',
        'Reach the sign-in page by typing the service name yourself, not by following this link.',
        18,
      ),
    )
  }

  if (/(?:[?&](?:url|target|redirect|redirect_uri|redirect_url|next|dest|to)=)/.test(pathAndQuery)) {
    indicators.push(
      indicator(
        'open_redirect',
        'Address bounces you somewhere else',
        'warning',
        'A forwarding parameter means the page you see first is not the page you end up on.',
        'Watch the address bar after it lands, and confirm you recognise the final site.',
        16,
      ),
    )
  }

  if (/\.(?:exe|msi|scr|apk|jar|vbs|bat|cmd|iso|zip\.exe)(?:\?|$)/.test(pathAndQuery)) {
    indicators.push(
      indicator('download_file', 'Link downloads a program', 'critical', 'This ends in an executable file type, so opening it installs something rather than showing a page.', 'Do not run it. Delete the message if you did not expect it.', 45),
    )
  }

  if (/@[a-z0-9.-]+\.(?:ph|com|net|org)\b/i.test(pathAndQuery) && url.username) {
    indicators.push(indicator('at_symbol_trick', 'An @ sign changes the real host', 'critical', 'Everything before an @ is ignored as a destination; the site is what comes after.', 'Do not open it.', 45))
  }

  return indicators
}

export function analyzeText(text: string): Indicator[] {
  const indicators: Indicator[] = []
  const lowered = text.toLowerCase()

  const credentialHit = CREDENTIAL_WORDS.find((word) => lowered.includes(word))
  if (credentialHit) {
    indicators.push(
      indicator(
        'asks_for_secret',
        'Asks you for something private',
        'critical',
        `It mentions "${credentialHit}". No legitimate company, bank or government office asks you to send or type a password, PIN, CVV or one-time code to them.`,
        'Stop. Enter nothing. If it claims to be your bank, call the number on the back of your card.',
        45,
      ),
    )
  }

  const urgencyHit = URGENCY_WORDS.find((word) => lowered.includes(word))
  if (urgencyHit) {
    indicators.push(
      indicator(
        'urgency',
        'Pushes you to act quickly',
        'warning',
        `Pressure phrase detected: "${urgencyHit}". Rushing you is the main technique, because acting before checking is what the sender needs.`,
        'Close the message, wait a minute, then check the account directly in the official app or website.',
        22,
      ),
    )
  }

  const rewardHit = REWARD_WORDS.find((word) => lowered.includes(word))
  if (rewardHit) {
    indicators.push(
      indicator(
        'too_good',
        'Offers money or a prize',
        'warning',
        `It promises something free ("${rewardHit}"). Prizes you never entered are the oldest bait there is.`,
        'Do not pay any "fee" to claim it, and do not send personal details.',
        25,
      ),
    )
  }

  if (/(?:transfer|send|load|top[- ]?up|gcash|maya)\s+(?:amount|money|₱|pesos?)/.test(lowered) || /gift card to (?:unlock|clear|pay)/.test(lowered)) {
    indicators.push(
      indicator('money_request', 'Asks for money to be moved', 'critical', 'Moving money or buying gift cards for someone you cannot verify is a scam outcome, not a mistake that can be undone.', 'Do not transfer anything. Confirm the request by voice with the person themselves.', 40),
    )
  }

  if (/(?:dear )?(?:customer|client|user|valued member)\b/.test(lowered) && !/\b(?:ms\.|mr\.|sir|madam)?\s+[A-Z][a-z]{2,}/.test(text)) {
    indicators.push(
      indicator(
        'generic_greeting',
        'Does not know your name',
        'caution',
        'It opens with a generic greeting. Real account notices from a service you use normally address you by name.',
        'Check whether the sender is really your provider by looking inside the official app.',
        10,
      ),
    )
  }

  for (const brand of KNOWN_BRANDS) {
    if (brand.length < 4) continue
    if (!lowered.includes(brand)) continue
    const hosts = extractLinks(text).flatMap((candidate) => {
      try {
        return [new URL(candidate.startsWith('http') ? candidate : `https://${candidate}`).hostname]
      } catch {
        return []
      }
    })
    const ownedByBrand = hosts.some((host) => host.toLowerCase().includes(`.${brand}.`) || host.toLowerCase().startsWith(`${brand}.`))
    if (hosts.length > 0 && !ownedByBrand) {
      indicators.push(
        indicator(
          'brand_impersonation',
          `Pretends to be ${brand}`,
          'critical',
          `The message speaks as ${brand}, but the links inside point to ${hosts.join(', ')} - which ${brand} does not control.`,
          `Ignore it. Open ${brand}'s own app or type their official address to check for real notices.`,
          45,
        ),
      )
      break
    }
  }

  if (/(?:reply to this|whatsapp me on|contact via telegram|message this number on viber)/.test(lowered)) {
    indicators.push(
      indicator('off_channel', 'Tries to move you to another channel', 'warning', 'Official processes do not continue on a personal chat number. Moving you off the platform avoids monitoring.', 'Do not message that number. Use the official support route.', 20),
    )
  }

  if (/(?:click|tap|open) (?:the|this) (?:link|here|button)/.test(lowered)) {
    indicators.push(
      indicator('click_bait', 'Tells you to click a link', 'caution', 'Instructions to click are only necessary when the sender cannot rely on you checking who they are.', 'Hover or long-press to read the full address first.', 8),
    )
  }

  return indicators
}

function buildGuidance(indicators: Indicator[], verdict: Verdict, linksFound: string[]): string[] {
  const advice = Array.from(new Set(indicators.filter((item) => item.severity !== 'info').map((item) => item.advice)))

  if (advice.length === 0) {
    return [
      'Nothing here matches a known scam pattern, but that is not a guarantee. If you did not expect this message, confirm with the sender through a channel you know.',
      linksFound.length > 0
        ? 'When in doubt, do not use the link: open the app or type the address yourself.'
        : 'When in doubt, open the app or type the address yourself instead of following a link.',
    ]
  }

  const closing =
    verdict === 'high'
      ? 'Treat this as hostile: do not click, do not reply, and if you already entered something, change that password now from the real site.'
      : verdict === 'suspicious'
        ? 'Do not enter any details from this message. Check the account directly in its official app.'
        : 'Proceed only after confirming the request with the service itself.'

  return [...advice, closing]
}

export function analyzeInput(text: string, kind: 'url' | 'message' | 'email'): AnalysisResult {
  const indicators: Indicator[] = []
  const linksFound = kind === 'url' ? [text.trim()] : extractLinks(text)

  if (kind === 'url') {
    indicators.push(...analyzeUrl(text))
  } else {
    indicators.push(...analyzeText(text))
    for (const link of linksFound) indicators.push(...analyzeUrl(link))
  }

  // Deduplicate by code, keeping the strongest statement of each pattern.
  const byCode = new Map<string, Indicator>()
  for (const item of indicators) {
    const existing = byCode.get(item.code)
    if (!existing || SEVERITY_WEIGHT[item.severity] > SEVERITY_WEIGHT[existing.severity]) byCode.set(item.code, item)
  }
  const unique = Array.from(byCode.values()).sort((a, b) => b.weight - a.weight)

  // Diminishing returns: the first signal matters most, repeats add less.
  let score = 0
  unique.forEach((item, index) => {
    score += item.weight * Math.pow(0.75, index)
  })

  // A domain that deliberately copies a service is not a grey area. Once
  // anything else about the item is also wrong, it is reported as high risk
  // rather than left to arithmetic that a short message can undershoot.
  const impersonates = unique.some((item) => IMPERSONATION_CODES.has(item.code))
  const corroborated = unique.some((item) => !IMPERSONATION_CODES.has(item.code) && SEVERITY_WEIGHT[item.severity] >= SEVERITY_WEIGHT.warning)
  if (impersonates && corroborated) score = Math.max(score, HIGH_RISK_FLOOR)

  const riskScore = Math.max(0, Math.min(100, Math.round(score)))
  const verdict = verdictFor(riskScore)

  return {
    verdict,
    riskScore,
    indicators: unique,
    guidance: buildGuidance(unique, verdict, linksFound),
    linksFound,
    engineVersion: ANALYZER_VERSION,
  }
}
