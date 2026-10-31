import fs from 'node:fs'
import path from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../config/env'
import { logger } from '../lib/logger'

let transporter: Transporter | null = null

function getTransporter(): Transporter {
  if (transporter) return transporter
  transporter = nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.port === 465,
    auth: env.mail.user ? { user: env.mail.user, pass: env.mail.password } : undefined,
  })
  return transporter
}

const OUTBOX_DIR = path.resolve(__dirname, '..', '..', '.outbox')

/**
 * Without SMTP configured, messages land in server/.outbox/ as plain text.
 * The verification and reset flows stay genuinely end-to-end in development
 * instead of being faked, and nothing is silently dropped.
 */
async function writeToOutbox(to: string, subject: string, text: string): Promise<void> {
  await fs.promises.mkdir(OUTBOX_DIR, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(':', "-")
  const file = path.join(OUTBOX_DIR, `${stamp}-${Math.random().toString(36).slice(2, 8)}.txt`)
  // 0o600: these files carry live one-time links.
  await fs.promises.writeFile(file, `To: ${to}\nSubject: ${subject}\n\n${text}\n`, { mode: 0o600 })
  logger.info('Wrote a message to the local outbox', { file, reason: 'SMTP is not configured' })
}

export async function sendEmail(input: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  if (env.mail.transportless) {
    await writeToOutbox(input.to, input.subject, input.text)
    return
  }
  await getTransporter().sendMail({
    from: env.mail.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    ...(input.html ? { html: input.html } : {}),
  })
}

export function verificationEmail(displayName: string, link: string) {
  return {
    subject: 'Confirm your Digital Guardian account',
    text:
      `Hi ${displayName},\n\n` +
      'Confirm this email address to finish setting up Digital Guardian:\n\n' +
      `${link}\n\n` +
      'The link works once and expires in 24 hours. If you did not create this ' +
      'account, you can ignore this message.\n\n— Digital Guardian',
  }
}

export function passwordResetEmail(displayName: string, link: string) {
  return {
    subject: 'Reset your Digital Guardian password',
    text:
      `Hi ${displayName},\n\n` +
      'Use this link to choose a new password:\n\n' +
      `${link}\n\n` +
      'The link works once and expires in 30 minutes. If you did not request a reset, ' +
      'no action is needed - your password stays as it is.\n\n— Digital Guardian',
  }
}
