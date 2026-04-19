import { readdir } from 'node:fs/promises'
import path from 'node:path'

const cwd = process.cwd()
const migrationsDir = path.join(cwd, 'supabase', 'migrations')

const files = (await readdir(migrationsDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort()

const remoteArtifacts = files.filter((name) => /_remote_schema\.sql$/i.test(name))
const invalidNames = files.filter((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name))

if (remoteArtifacts.length || invalidNames.length) {
  if (remoteArtifacts.length) {
    console.error('Synthetic Supabase pull artifacts are not part of the canonical migration chain:')
    for (const file of remoteArtifacts) console.error(`- ${file}`)
  }

  if (invalidNames.length) {
    console.error('Migration filenames must follow the canonical <timestamp>_<snake_case>.sql pattern:')
    for (const file of invalidNames) console.error(`- ${file}`)
  }

  process.exit(1)
}

console.log(`Supabase migration check passed (${files.length} active migrations).`)
