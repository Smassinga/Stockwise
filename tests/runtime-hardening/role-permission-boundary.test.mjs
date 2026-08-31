import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const read = async file => readFile(new URL(file, root), 'utf8')

async function sourceFiles(dir) {
  const entries = await readdir(new URL(dir, root), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relative = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(relative))
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(relative)
  }
  return files
}

test('canonical permissions preserve the company role assignment matrix', async () => {
  const permissions = await read('src/lib/permissions.ts')
  assert.match(permissions, /export function canAssignRole\(actor: CompanyRole \| null \| undefined, target: CompanyRole\): boolean/)
  assert.match(permissions, /if \(a === 'OWNER'\) return true/)
  assert.match(permissions, /if \(a === 'ADMIN'\) return \['VIEWER', 'OPERATOR', 'MANAGER', 'ADMIN'\]\.includes\(target\)/)
  assert.match(permissions, /if \(a === 'MANAGER'\) return \['VIEWER', 'OPERATOR', 'MANAGER'\]\.includes\(target\)/)
  assert.match(permissions, /export function canInviteRole[\s\S]*return canAssignRole\(actor, target\)/)
  assert.match(permissions, /export const CanManageUsers: readonly \('MANAGER' \| 'ADMIN' \| 'OWNER'\)\[] = \[[\s\S]*'MANAGER',[\s\S]*'ADMIN',[\s\S]*'OWNER',[\s\S]*\]/)
})

test('legacy role compatibility module and imports are removed', async () => {
  await assert.rejects(access(new URL('src/lib/roles.ts', root)))
  const files = await sourceFiles('src')
  for (const file of files) {
    const source = await read(file)
    assert.doesNotMatch(source, /(?:from|import\()\s*['"][^'"]*\/roles['"]/, `${file} still imports the legacy roles module`)
  }
})
