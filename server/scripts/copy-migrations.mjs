// tsc only emits JavaScript, so the .sql migration files have to be copied into
// dist for a compiled `npm start` to find them.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(root, 'src', 'db', 'migrations')
const to = path.join(root, 'dist', 'db', 'migrations')

fs.mkdirSync(to, { recursive: true })
const files = fs.readdirSync(from).filter((name) => name.endsWith('.sql'))
for (const file of files) fs.copyFileSync(path.join(from, file), path.join(to, file))
console.log(`[build] copied ${files.length} migration(s) into dist/db/migrations`)
