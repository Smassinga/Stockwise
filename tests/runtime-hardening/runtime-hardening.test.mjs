import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

function read(path) {
  return readFileSync(path, 'utf8')
}

test('Tauri filesystem scope stays least-privilege', () => {
  const capability = JSON.parse(read('src-tauri/capabilities/main.json'))
  const serialized = JSON.stringify(capability)

  assert.equal(serialized.includes('$HOME/**'), false, 'desktop capability must not expose the whole home directory')
  assert.equal(serialized.includes('$TEMP/**'), false, 'desktop capability must not expose the whole temp directory')
  assert.equal(serialized.includes('$APPDATA/**'), false, 'desktop capability must not add blanket app-data scope')
  assert.equal(serialized.includes('$APPLOCALDATA/**'), false, 'desktop capability must not add blanket local-app-data scope')
  assert.ok(capability.permissions.includes('fs:default'), 'Tauri should retain the scoped filesystem default')
})

test('Tauri CSP remains enabled and restrictive', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'))
  const csp = config?.app?.security?.csp

  assert.ok(csp && typeof csp === 'object', 'Tauri CSP must not be null or disabled')
  assert.equal(csp['object-src'], "'none'")
  assert.equal(csp['script-src'], "'self'")
  assert.match(csp['connect-src'], /https:\/\/\*\.supabase\.co/)
})

test('Vite development server is local by default with explicit LAN opt-in', () => {
  const vite = read('vite.config.ts')

  assert.match(vite, /host:\s*explicitLanDev\s*\?\s*true\s*:\s*'127\.0\.0\.1'/)
  assert.match(vite, /allowedHosts:\s*explicitLanDev\s*\?\s*true\s*:\s*\['localhost',\s*'127\.0\.0\.1'\]/)
  assert.doesNotMatch(vite, /host:\s*true,\s*\n\s*allowedHosts:\s*true/)
})

test('Digest worker never accepts secrets from the URL query string', () => {
  const digest = read('supabase/functions/digest-worker/index.ts')

  assert.doesNotMatch(digest, /DEBUG_ACCEPT_QUERY_KEY/)
  assert.doesNotMatch(digest, /searchParams\.get\(["']key["']\)/)
  assert.match(digest, /x-webhook-secret/)
  assert.match(digest, /Bearer /)
  assert.match(digest, /function safeErr\(error: unknown\)/)
})

test('Legacy direct-sale source path stays removed', () => {
  assert.equal(existsSync('src/lib/sales.ts'), false, 'legacy direct sales/stock mutation helper must not return')
})

test('Generated QA and machine state remain ignored', () => {
  const gitignore = read('.gitignore')

  for (const entry of ['/output/', '/.codex/environments/', '/.npm-cache/', '/.pip-cache/', '/.playwright-cli/']) {
    assert.ok(gitignore.includes(entry), `missing generated-state ignore rule: ${entry}`)
  }
})
