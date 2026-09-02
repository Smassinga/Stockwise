import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('OrgProvider does not blockingly refresh an already-resolved user on repeated SIGNED_IN events', async () => {
  const source = await read('src/hooks/useOrg.tsx')

  assert.match(source, /onAuthStateChange\(\(event, session\) => \{/)
  assert.match(source, /if \(event === "SIGNED_OUT"\) \{\s*void refresh\(\);\s*return;\s*\}/)
  assert.match(source, /if \(event !== "SIGNED_IN"\) return;/)
  assert.match(source, /incomingUserId = session\?\.user\?\.id \?\? null/)
  assert.match(source, /lastResolvedUserRef\.current === incomingUserId/)
  assert.match(source, /orgSnapshotRef\.current\.companyId \|\| orgSnapshotRef\.current\.companies\.length > 0/)
  assert.match(source, /if \(sameResolvedUser && hasResolvedOrg\) return;/)
  assert.doesNotMatch(source, /\["SIGNED_IN", "SIGNED_OUT"\]\.includes\(event\)/)
})
