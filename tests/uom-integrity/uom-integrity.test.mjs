import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('UOM integrity migration defines governed catalogue authority', async () => {
  const migration = await read('supabase/migrations/20260810051808_enforce_canonical_uom_integrity.sql')

  assert.match(migration, /delete from public\.uoms[\s\S]*c09965f9-909f-4453-b26e-7dcebda1c1f5/)
  assert.match(migration, /uom_integrity_candidate_referenced:/)
  assert.match(migration, /create unique index if not exists uq_uoms_semantic_equivalence/)
  assert.match(migration, /revoke all on table public\.uoms from anon, authenticated/)
  assert.match(migration, /grant select on table public\.uoms to anon, authenticated/)
  assert.match(migration, /create or replace function public\.create_uom/)
  assert.match(migration, /security definer\s+set search_path = pg_catalog, public/)
  assert.match(migration, /uom_code_exists:/)
})

test('governed UOM creation passes the rollback-only local SQL matrix', async (context) => {
  const sql = await read('tests/uom-integrity/uom-integrity.sql')
  const result = spawnSync(
    'docker',
    ['exec', '-i', 'supabase_db_Stockwise', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8' },
  )

  if (result.error?.code === 'ENOENT') {
    context.skip('Docker is unavailable; run this test when the local Supabase stack is active.')
    return
  }

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const output = `${result.stdout}\n${result.stderr}`
  assert.match(output, /PASS canonical reuse/)
  assert.match(output, /PASS legitimate custom creation and provenance/)
  assert.match(output, /PASS direct TRUNCATE denied/)
})
