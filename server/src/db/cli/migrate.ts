import { migrationStatus, runMigrations } from '../migrate'
import { closePool } from '../pool'

async function main() {
  if (process.argv.includes('--status')) {
    const entries = await migrationStatus()
    for (const entry of entries) {
      const marker = entry.state === 'applied' ? 'x' : '-'
      const when = entry.appliedAt ? ` (${new Date(entry.appliedAt).toISOString()})` : ''
      const drift = entry.drifted ? ' [checksum drift!]' : ''
      console.log(`${marker} ${entry.name}${when}${drift}`)
    }
    const pending = entries.filter((entry) => entry.state === 'pending').length
    console.log(`\n${entries.length - pending} applied, ${pending} pending`)
    return
  }

  const entries = await migrationStatus()
  const pending = entries.filter((entry) => entry.state === 'pending').length
  console.log(`[migrate] ${pending} migration(s) to apply`)
  await runMigrations({ onMessage: (message) => console.log(`[migrate] ${message}`) })
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(`[migrate] ${(error as Error).message}`)
    await closePool().catch(() => undefined)
    process.exit(1)
  })
