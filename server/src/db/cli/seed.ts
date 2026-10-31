import { query, closePool } from '../pool'
import { logger } from '../../lib/logger'

/**
 * Catalogue content, not user data. Every statement is an idempotent upsert so
 * `npm run seed` can be re-run after a reset without duplicating anything.
 */
const PRIVACY_ITEMS: Array<{ key: string; label: string; guidance: string; category: string }> = [
  {
    key: 'inventory_accounts',
    label: 'List every account that holds something you would miss',
    guidance: 'Start with email, then banking, school and work accounts, then the social ones you stopped thinking about.',
    category: 'data',
  },
  {
    key: 'unique_passwords',
    label: 'Give each important account its own password',
    guidance: 'One reused password is one leaked site away from every account. A password manager makes this practical.',
    category: 'identity',
  },
  {
    key: 'mfa_on_email',
    label: 'Turn on two-step verification on your main email address',
    guidance: 'Email resets the password for everything else, so it is the account worth the extra step first.',
    category: 'identity',
  },
  {
    key: 'recovery_details_current',
    label: 'Check the recovery phone and backup email on each important account',
    guidance: 'An old number you no longer own is a door someone else can walk through later.',
    category: 'identity',
  },
  {
    key: 'review_third_party_access',
    label: 'Review apps and sites signed in with your email account',
    guidance: 'Each connected app can read or post on your behalf. Remove the ones you cannot place.',
    category: 'permissions',
  },
  {
    key: 'review_app_permissions',
    label: 'Trim permissions you granted to phone apps',
    guidance: 'Location, contacts, microphone and photos are the four worth checking one at a time.',
    category: 'permissions',
  },
  {
    key: 'profile_visibility',
    label: 'Decide who can see each social profile you still use',
    guidance: 'Public profiles are harvested to build convincing messages aimed at you.',
    category: 'visibility',
  },
  {
    key: 'search_indexing',
    label: 'Check whether your accounts appear in search results',
    guidance: 'Turning off discoverability by email or phone number stops strangers from finding your profile.',
    category: 'visibility',
  },
  {
    key: 'data_export_request',
    label: 'Request a copy of your data from one major service',
    guidance: 'The download shows exactly what a company holds on you, and it is your right to ask in most countries.',
    category: 'data',
  },
  {
    key: 'close_unused_accounts',
    label: 'Close accounts you have not used in a year',
    guidance: 'A forgotten account cannot be updated, monitored, or protected - but it can still be taken over.',
    category: 'data',
  },
  {
    key: 'financial_alerts_on',
    label: 'Turn on transaction and sign-in alerts for money accounts',
    guidance: 'Bank and payment apps will tell you about unusual activity faster than you would notice it.',
    category: 'financial',
  },
  {
    key: 'breach_check',
    label: 'Check whether your email appears in a known breach',
    guidance: 'Have I Been Pwned tells you which sites leaked your address, so you know where to change passwords.',
    category: 'identity',
  },
  {
    key: 'device_screen_lock',
    label: 'Confirm every device that signs you in has a lock',
    guidance: 'Biometrics or a PIN, plus auto-lock. A saved session without a screen lock is an open account.',
    category: 'permissions',
  },
  {
    key: 'shared_devices_signed_out',
    label: 'Sign out of accounts on devices you no longer control',
    guidance: 'Family laptops, library machines and old phones keep sessions alive long after you leave.',
    category: 'social',
  },
]

async function seed() {
  let position = 0
  for (const item of PRIVACY_ITEMS) {
    position += 10
    await query(
      `insert into privacy_items (key, label, guidance, category, position, published)
       values ($1, $2, $3, $4, $5, true)
       on conflict (key) do update
         set label = excluded.label, guidance = excluded.guidance, category = excluded.category, position = excluded.position`,
      [item.key, item.label, item.guidance, item.category, position],
    )
  }

  const counts = await query<{ roles: string; privacy_items: string; settings: string }>(
    `select
       (select count(*) from roles)::text as roles,
       (select count(*) from privacy_items where published)::text as privacy_items,
       (select count(*) from system_settings)::text as settings`,
  )
  logger.info('Seed complete', { ...counts.rows[0] })
}

/**
 * Promotion happens here rather than in the seed file so no administrator
 * password is ever written into the repository.
 */
async function promote(email: string) {
  const updated = await query('update users set role_key = $2 where email_normalized = $1 returning id', [email.toLowerCase(), 'admin'])
  if ((updated.rowCount ?? 0) === 0) {
    logger.error(`No account matches ${email}. Register it first, then promote it.`)
    process.exitCode = 1
    return
  }
  logger.info('Account promoted to administrator')
}

async function main() {
  const args = process.argv.slice(2)
  const promoteIndex = args.indexOf('--admin')
  if (promoteIndex >= 0) {
    const email = args[promoteIndex + 1]
    if (!email) {
      logger.error('Usage: npm run seed -- --admin you@example.com')
      process.exitCode = 1
    } else {
      await promote(email)
    }
  } else {
    await seed()
  }
}

main().then(
  async () => {
    await closePool()
  },
  async (error) => {
    logger.error('Seed failed', { error })
    process.exitCode = 1
    await closePool()
  },
)
