import fs from 'node:fs'

const appPath = 'src/App.tsx'
const navigationPath = 'src/components/layout/navigation.ts'
const setupPath = 'src/lib/companySetupReadiness.ts'
const testPath = 'tests/runtime-hardening/route-canonicalization.test.mjs'

let app = fs.readFileSync(appPath, 'utf8')
let navigation = fs.readFileSync(navigationPath, 'utf8')
let setup = fs.readFileSync(setupPath, 'utf8')

const legacyRoute = '                <Route path="/uom" element={<Suspense fallback={<LoadingSplash />}><UomSettings /></Suspense>} />'
const canonicalRedirect = '                <Route path="/uom" element={<Navigate to="/settings/uoms" replace />} />'
if (!app.includes(legacyRoute)) throw new Error('Legacy /uom direct-render route not found')
if ((app.match(/path="\/uom"/g) || []).length !== 1) throw new Error('Expected exactly one /uom route')
app = app.replace(legacyRoute, canonicalRedirect)

const legacyNavigation = "  { id: 'uom', group: 'administration', labelKey: 'nav.uom', fallbackLabel: 'Units of Measure', to: '/uom', icon: Ruler },"
const canonicalNavigation = "  { id: 'uom', group: 'administration', labelKey: 'nav.uom', fallbackLabel: 'Units of Measure', to: '/settings/uoms', icon: Ruler },"
if (!navigation.includes(legacyNavigation)) throw new Error('Legacy UOM navigation definition not found')
navigation = navigation.replace(legacyNavigation, canonicalNavigation)

const setupLegacyMatches = setup.match(/'\/uom'/g) || []
if (setupLegacyMatches.length !== 2) throw new Error(`Expected exactly two setup /uom routes, found ${setupLegacyMatches.length}`)
setup = setup.replaceAll("'/uom'", "'/settings/uoms'")

const test = `import assert from 'node:assert/strict'\nimport { readFile } from 'node:fs/promises'\nimport test from 'node:test'\n\nconst read = (path) => readFile(new URL(\`../../\${path}\`, import.meta.url), 'utf8')\n\nconst app = await read('src/App.tsx')\nconst navigation = await read('src/components/layout/navigation.ts')\nconst setupReadiness = await read('src/lib/companySetupReadiness.ts')\nconst routeMetadata = await read('src/components/RouteMetadata.tsx')\n\ntest('UOM uses one canonical internal route while preserving the legacy alias', () => {\n  assert.match(app, /path=\"\\/settings\\/uoms\"[^\\n]*<UomSettings \\/>/)\n  assert.ok(app.includes('<Route path=\"/uom\" element={<Navigate to=\"/settings/uoms\" replace />} />'))\n  assert.doesNotMatch(app, /path=\"\\/uom\"[^\\n]*<UomSettings \\/>/)\n\n  assert.match(navigation, /id: 'uom'[^\\n]*to: '\\/settings\\/uoms'/)\n  assert.doesNotMatch(navigation, /id: 'uom'[^\\n]*to: '\\/uom'/)\n  assert.ok(navigation.includes("if (item.id === 'uom') return pathname === '/uom' || pathname === '/settings/uoms'"))\n\n  assert.doesNotMatch(setupReadiness, /route:\\s*'\\/uom'/)\n  assert.doesNotMatch(setupReadiness, /consequence', '\\/uom'/)\n  assert.ok(setupReadiness.includes("'/settings/uoms'"))\n\n  assert.ok(routeMetadata.includes("'/settings/uoms': ['nav.uom', 'Units of Measure']"))\n  assert.ok(routeMetadata.includes("'/uom': ['nav.uom', 'Units of Measure']"))\n})\n`

fs.writeFileSync(appPath, app)
fs.writeFileSync(navigationPath, navigation)
fs.writeFileSync(setupPath, setup)
fs.writeFileSync(testPath, test)
console.log('Canonicalized UOM route while preserving /uom compatibility redirect')
