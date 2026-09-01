import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const app = await read('src/App.tsx')
const navigation = await read('src/components/layout/navigation.ts')
const setupReadiness = await read('src/lib/companySetupReadiness.ts')
const routeMetadata = await read('src/components/RouteMetadata.tsx')

test('UOM uses one canonical internal route while preserving the legacy alias', () => {
  assert.match(app, /path="\/settings\/uoms"[^\n]*<UomSettings \/>/)
  assert.ok(app.includes('<Route path="/uom" element={<Navigate to="/settings/uoms" replace />} />'))
  assert.doesNotMatch(app, /path="\/uom"[^\n]*<UomSettings \/>/)

  assert.match(navigation, /id: 'uom'[^\n]*to: '\/settings\/uoms'/)
  assert.doesNotMatch(navigation, /id: 'uom'[^\n]*to: '\/uom'/)
  assert.ok(navigation.includes("if (item.id === 'uom') return pathname === '/uom' || pathname === '/settings/uoms'"))

  assert.doesNotMatch(setupReadiness, /route:\s*'\/uom'/)
  assert.doesNotMatch(setupReadiness, /consequence', '\/uom'/)
  assert.ok(setupReadiness.includes("'/settings/uoms'"))

  assert.ok(routeMetadata.includes("'/settings/uoms': ['nav.uom', 'Units of Measure']"))
  assert.ok(routeMetadata.includes("'/uom': ['nav.uom', 'Units of Measure']"))
})
