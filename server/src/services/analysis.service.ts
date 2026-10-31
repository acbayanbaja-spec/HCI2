import { AppError } from '../lib/errors'
import { query, queryOne } from '../db/pool'
import { digestIp, digestToken } from '../lib/crypto'
import { recordSecurityEvent } from './audit.service'
import { createNotification } from './notification.service'
import { refreshAssessment } from './recommendation.service'
import { analyzeInput, type AnalysisResult, type Verdict } from './analyzer.engine'

export type AnalysisInputKind = 'url' | 'message' | 'email'

export type StoredAnalysis = AnalysisResult & {
  id: string
  inputKind: AnalysisInputKind
  createdAt: Date
  /** Honest scope statement shown with every result. */
  disclaimer: string
}

const DISCLAIMER =
  'This checks for patterns commonly used in scams. It is not a virus scan and cannot see what a page does after it loads. A clean result is not a guarantee of safety.'

function excerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 500)
}

export async function runAnalysis(options: {
  userId: string
  kind: AnalysisInputKind
  input: string
  ip: string | null
}): Promise<StoredAnalysis> {
  const result = analyzeInput(options.input, options.kind)
  const createdAt = new Date()

  const row = await queryOne<{ id: string }>(
    `insert into content_analyses
       (user_id, input_kind, input_excerpt, input_hash, verdict, risk_score, indicators, guidance, links_found, engine_version)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
     returning id`,
    [
      options.userId,
      options.kind,
      excerpt(options.input),
      digestToken(options.input),
      result.verdict,
      result.riskScore,
      JSON.stringify(result.indicators),
      JSON.stringify(result.guidance),
      JSON.stringify(result.linksFound),
      result.engineVersion,
    ],
  )

  await recordSecurityEvent({
    userId: options.userId,
    category: 'analysis',
    eventType: 'content_analyzed',
    message: `Checked a ${options.kind}: flagged as ${result.verdict} (${result.riskScore}/100).`,
    severity: result.verdict === 'high' ? 'warning' : result.verdict === 'suspicious' ? 'caution' : 'info',
    ipHash: options.ip ? digestIp(options.ip) : null,
    metadata: { analysisId: row?.id, verdict: result.verdict, indicatorCodes: result.indicators.map((item) => item.code) },
  })

  // Something this hostile should not live only in a history list.
  if (result.verdict === 'high' || result.verdict === 'suspicious') {
    await createNotification({
      userId: options.userId,
      kind: 'security_alert',
      severity: result.verdict === 'high' ? 'critical' : 'warning',
      title: result.verdict === 'high' ? 'A link you checked looks hostile' : 'A link you checked looks suspicious',
      body:
        result.indicators[0]?.detail ??
        'Several scam patterns matched. Do not enter any details from it.',
      link: `/check-link/${row?.id ?? ''}`,
      dedupeKey: `analysis:${row?.id}`,
    })
  }

  // A suspicious link is a real change in exposure, so refresh the score.
  await refreshAssessment(options.userId, 'analysis_run')

  return {
    id: row?.id ?? '',
    inputKind: options.kind,
    createdAt,
    disclaimer: DISCLAIMER,
    ...result,
  }
}

export async function getAnalysis(userId: string, id: string): Promise<StoredAnalysis> {
  const row = await queryOne<Record<string, unknown>>(
    `select id, input_kind, verdict, risk_score, indicators, guidance, links_found, created_at, engine_version
       from content_analyses where user_id = $1 and id = $2`,
    [userId, id],
  )
  if (!row) throw AppError.notFound('That check is no longer in your history.')

  return {
    id: String(row.id),
    inputKind: row.input_kind as AnalysisInputKind,
    verdict: row.verdict as Verdict,
    riskScore: Number(row.risk_score),
    indicators: row.indicators as AnalysisResult['indicators'],
    guidance: row.guidance as string[],
    linksFound: row.links_found as string[],
    engineVersion: Number(row.engine_version),
    createdAt: new Date(String(row.created_at)),
    disclaimer: DISCLAIMER,
  }
}

export async function listAnalyses(userId: string, limit = 25) {
  const { rows } = await query(
    `select id, input_kind as "inputKind", input_excerpt as "inputExcerpt", verdict,
            risk_score as "riskScore", created_at as "createdAt"
       from content_analyses
      where user_id = $1
      order by created_at desc
      limit $2`,
    [userId, Math.min(Math.max(limit, 1), 100)],
  )
  return rows
}

export type ReportInput = {
  userId: string
  analysisId?: string | null
  target: string
  claimedBrand?: string | null
  reason?: string | null
}

/** Secure reporting workflow: the item enters an admin triage queue. */
export async function reportSuspiciousContent(input: ReportInput) {
  const report = await queryOne<{ id: string; status: string }>(
    `insert into content_reports (analysis_id, reporter_user_id, target, target_hash, claimed_brand, user_reason)
     values ($1, $2, $3, $4, $5, $6)
     returning id, status`,
    [
      input.analysisId ?? null,
      input.userId,
      excerpt(input.target),
      digestToken(input.target),
      input.claimedBrand?.slice(0, 60) ?? null,
      input.reason?.slice(0, 1000) ?? null,
    ],
  )
  if (!report) throw new AppError(500, 'internal_error', 'The report could not be filed.')

  await recordSecurityEvent({
    userId: input.userId,
    category: 'report',
    eventType: 'suspicious_content_reported',
    message: 'Reported suspicious content to the administrators.',
    metadata: { reportId: report.id },
  })

  await createNotification({
    userId: input.userId,
    kind: 'report_update',
    severity: 'info',
    title: 'Report received',
    body: 'An administrator will review what you reported. You will see the outcome here.',
    link: `/reports/${report.id}`,
    dedupeKey: `report:${report.id}:received`,
  })

  return { id: report.id, status: report.status as 'new' }
}

export async function listUserReports(userId: string) {
  const { rows } = await query(
    `select id, target, status, claimed_brand as "claimedBrand",
            admin_notes as "adminNotes", created_at as "createdAt", reviewed_at as "reviewedAt"
       from content_reports
      where reporter_user_id = $1
      order by created_at desc
      limit 50`,
    [userId],
  )
  return rows
}

export async function getReportForUser(userId: string, reportId: string) {
  return queryOne<Record<string, unknown>>(
    `select id, target, status, claimed_brand, admin_notes, user_reason, created_at, reviewed_at
       from content_reports
      where reporter_user_id = $1 and id = $2`,
    [userId, reportId],
  )
}
