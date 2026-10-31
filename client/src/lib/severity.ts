import {
  CircleAlert,
  CircleCheck,
  Info,
  OctagonAlert,
  ShieldAlert,
  ShieldCheck,
  ShieldHalf,
  ShieldX,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import type { AnalysisVerdict, FactorStatus, IndicatorSeverity, RecommendationPriority, ScoreBand } from './api-types'

/**
 * Colour is never the only signal: each tone below also carries an icon and a
 * written label, so a colour-blind or screen-reader user gets the same message.
 */
export type Tone = 'good' | 'watch' | 'warn' | 'danger' | 'info' | 'neutral'

export type SeverityDescriptor = { label: string; tone: Tone; Icon: LucideIcon; description: string }

export const TONE_CLASSES: Record<Tone, { text: string; soft: string; border: string; solid: string; ring: string; bar: string }> = {
  good: {
    text: 'text-good',
    soft: 'bg-good-soft',
    border: 'border-good/40',
    solid: 'bg-good text-white dark:text-black',
    ring: 'ring-good/40',
    bar: 'bg-good',
  },
  watch: {
    text: 'text-watch',
    soft: 'bg-watch-soft',
    border: 'border-watch/40',
    solid: 'bg-watch text-white dark:text-black',
    ring: 'ring-watch/40',
    bar: 'bg-watch',
  },
  warn: {
    text: 'text-warn',
    soft: 'bg-warn-soft',
    border: 'border-warn/40',
    solid: 'bg-warn text-white dark:text-black',
    ring: 'ring-warn/40',
    bar: 'bg-warn',
  },
  danger: {
    text: 'text-danger',
    soft: 'bg-danger-soft',
    border: 'border-danger/40',
    solid: 'bg-danger text-white dark:text-black',
    ring: 'ring-danger/40',
    bar: 'bg-danger',
  },
  info: {
    text: 'text-info',
    soft: 'bg-info-soft',
    border: 'border-info/40',
    solid: 'bg-info text-white',
    ring: 'ring-info/40',
    bar: 'bg-info',
  },
  neutral: {
    text: 'text-muted',
    soft: 'bg-sunken',
    border: 'border-line',
    solid: 'bg-line-strong text-ink',
    ring: 'ring-line-strong/50',
    bar: 'bg-line-strong',
  },
}

const BANDS: Record<ScoreBand, SeverityDescriptor> = {
  strong: { label: 'Strong', tone: 'good', Icon: ShieldCheck, description: 'Well protected across the areas Digital Guardian can see.' },
  protected: { label: 'Protected', tone: 'good', Icon: ShieldHalf, description: 'Solid protection with a little room to tighten.' },
  fair: { label: 'Needs work', tone: 'watch', Icon: ShieldHalf, description: 'Protected in places, with gaps worth closing.' },
  at_risk: { label: 'At risk', tone: 'warn', Icon: ShieldAlert, description: 'Several protections are missing.' },
  critical: { label: 'Critical', tone: 'danger', Icon: ShieldX, description: 'This account is exposed. Start with the highest priority action.' },
}

export function bandDescriptor(band: ScoreBand): SeverityDescriptor {
  return BANDS[band] ?? BANDS.fair
}

const VERDICTS: Record<AnalysisVerdict, SeverityDescriptor> = {
  low: { label: 'LOW RISK', tone: 'good', Icon: CircleCheck, description: 'No common scam patterns found in what you pasted.' },
  caution: { label: 'BE CAREFUL', tone: 'watch', Icon: Info, description: 'Some details are worth a second look before you act.' },
  suspicious: { label: 'SUSPICIOUS', tone: 'warn', Icon: TriangleAlert, description: 'Several scam patterns matched. Do not enter details yet.' },
  high: { label: 'HIGH RISK', tone: 'danger', Icon: OctagonAlert, description: 'This looks like an attempt to steal something. Do not click or reply.' },
}

export function verdictDescriptor(verdict: AnalysisVerdict): SeverityDescriptor {
  return VERDICTS[verdict] ?? VERDICTS.caution
}

const SEVERITIES: Record<IndicatorSeverity, SeverityDescriptor> = {
  info: { label: 'Note', tone: 'info', Icon: Info, description: '' },
  caution: { label: 'Caution', tone: 'watch', Icon: CircleAlert, description: '' },
  warning: { label: 'Warning', tone: 'warn', Icon: TriangleAlert, description: '' },
  critical: { label: 'Critical', tone: 'danger', Icon: OctagonAlert, description: '' },
}

export function severityDescriptor(severity: IndicatorSeverity): SeverityDescriptor {
  return SEVERITIES[severity] ?? SEVERITIES.info
}

const PRIORITIES: Record<RecommendationPriority, SeverityDescriptor> = {
  high: { label: 'High priority', tone: 'danger', Icon: ShieldAlert, description: 'Do this first.' },
  medium: { label: 'Medium priority', tone: 'watch', Icon: CircleAlert, description: 'Worth doing this week.' },
  low: { label: 'Low priority', tone: 'info', Icon: Info, description: 'Nice to tighten when you have a moment.' },
}

export function priorityDescriptor(priority: RecommendationPriority): SeverityDescriptor {
  return PRIORITIES[priority] ?? PRIORITIES.low
}

const FACTOR_STATUS: Record<FactorStatus, { label: string; tone: Tone }> = {
  satisfied: { label: 'Covered', tone: 'good' },
  partial: { label: 'Partly covered', tone: 'watch' },
  failing: { label: 'Not covered', tone: 'danger' },
  not_applicable: { label: 'Not applicable', tone: 'neutral' },
}

export function factorStatusDescriptor(status: FactorStatus) {
  return FACTOR_STATUS[status] ?? FACTOR_STATUS.partial
}
