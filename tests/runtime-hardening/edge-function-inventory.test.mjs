import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const read = async path => readFile(new URL(path, root), 'utf8')

const inventory = JSON.parse(await read('docs/runtime/edge-function-inventory.json'))
const config = await read('supabase/config.toml')

function configuredFunctions(source) {
  const entries = new Map()
  const pattern = /\[functions\.([^\]]+)\]([\s\S]*?)(?=\n\[functions\.|$)/g
  for (const match of source.matchAll(pattern)) {
    const [, name, block] = match
    const enabled = /\benabled\s*=\s*true\b/.test(block)
    const verifyJwt = /\bverify_jwt\s*=\s*true\b/.test(block)
      ? true
      : /\bverify_jwt\s*=\s*false\b/.test(block)
        ? false
        : null
    entries.set(name, { enabled, verifyJwt })
  }
  return entries
}

const knownStatuses = new Set([
  'active_internal',
  'active_user_flow',
  'active_worker',
  'active_platform_flow',
  'dormant_retained',
  'qa_only',
])

test('every deployed Edge Function is classified and every classified function exists', async () => {
  assert.equal(inventory.schemaVersion, 1)
  const classified = Object.keys(inventory.functions).sort()
  const configured = [...configuredFunctions(config).keys()].sort()

  const functionEntries = await readdir(new URL('supabase/functions/', root), { withFileTypes: true })
  const directories = functionEntries
    .filter(entry => entry.isDirectory() && entry.name !== '_shared')
    .map(entry => entry.name)
    .sort()

  assert.deepEqual(classified, configured, 'supabase/config.toml and the runtime inventory must classify the same functions')
  assert.deepEqual(classified, directories, 'every non-shared Edge Function directory must be represented in the runtime inventory')
})

test('inventory pins deployment auth posture and removal evidence', async () => {
  const configured = configuredFunctions(config)

  for (const [name, entry] of Object.entries(inventory.functions)) {
    assert.ok(knownStatuses.has(entry.status), `${name}: unknown runtime status ${entry.status}`)
    assert.equal(typeof entry.removalGate, 'string', `${name}: removalGate is required`)
    assert.ok(entry.removalGate.trim().length >= 20, `${name}: removalGate must contain meaningful evidence requirements`)

    const deployment = configured.get(name)
    assert.ok(deployment, `${name}: missing from supabase/config.toml`)
    assert.equal(deployment.enabled, true, `${name}: inventory only covers enabled deployed functions`)
    assert.equal(deployment.verifyJwt, entry.verifyJwt, `${name}: verify_jwt changed without updating runtime governance`)

    const source = await read(`supabase/functions/${name}/index.ts`)
    if (entry.verifyJwt === false) {
      assert.ok(entry.secondaryAuth, `${name}: verify_jwt=false requires an explicit secondary authentication contract`)
      assert.ok(Array.isArray(entry.secondaryAuth.sourceMarkers) && entry.secondaryAuth.sourceMarkers.length > 0, `${name}: secondary auth markers are required`)
      for (const marker of entry.secondaryAuth.sourceMarkers) {
        assert.ok(source.includes(marker), `${name}: missing secondary authentication marker ${marker}`)
      }
    }

    if (entry.secondaryAuth?.sourceMarkers) {
      for (const marker of entry.secondaryAuth.sourceMarkers) {
        assert.ok(source.includes(marker), `${name}: missing declared secondary auth marker ${marker}`)
      }
    }

    if (entry.status === 'qa_only') {
      assert.ok(entry.killSwitch?.sourceMarkers?.length, `${name}: QA-only functions require a fail-closed kill switch contract`)
      for (const marker of entry.killSwitch.sourceMarkers) {
        assert.ok(source.includes(marker), `${name}: missing QA kill-switch marker ${marker}`)
      }
    }
  }
})

test('dormant and QA-only functions cannot be mistaken for dead code by UI-reference searches', () => {
  const dormant = Object.entries(inventory.functions).filter(([, entry]) => entry.status === 'dormant_retained')
  const qaOnly = Object.entries(inventory.functions).filter(([, entry]) => entry.status === 'qa_only')

  assert.ok(dormant.length > 0, 'at least one explicitly dormant-retained endpoint should remain classified while retained')
  assert.ok(qaOnly.length > 0, 'QA-only endpoints must remain explicitly classified while present')
  for (const [name, entry] of [...dormant, ...qaOnly]) {
    assert.ok(entry.removalGate, `${name}: retained non-production surfaces require explicit removal evidence`)
  }
})
