import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Settings and Users use direct headings, structural loading, and open summaries', async () => {
  const [settings, users] = await Promise.all([
    read('src/pages/Settings.tsx'),
    read('src/pages/Users.tsx'),
  ])

  assert.match(settings, /headerTitle: "Settings"/)
  assert.doesNotMatch(settings, /Settings command centre/)
  assert.match(settings, /<PremiumSkeleton variant="detail"/)
  assert.match(settings, /<OperationalSummaryBand/)

  assert.doesNotMatch(users, /description=\{tt\('users\.subtitle'/)
  assert.match(users, /loading \? \(/)
  assert.match(users, /<PremiumSkeleton variant="summary"/)
  assert.match(users, /<OperationalSummaryBand/)
  assert.match(users, /<PremiumStatusBadge tone=\{statusTone\(member\.status\)\}>/)
})

test('UOM administration delegates creation to the governed RPC and reuses equivalents', async () => {
  const [uomPage, uomLib] = await Promise.all([
    read('src/pages/UomSettings.tsx'),
    read('src/lib/uom.ts'),
  ])

  assert.match(uomLib, /\[A-F0-9\]\{8\}/)
  assert.match(uomPage, /uomCodeLooksGenerated/)
  assert.match(uomPage, /tryConvertQty/)
  assert.match(uomPage, /Legacy generated unit codes/)
  assert.match(uomPage, /supabase\.rpc\('create_uom'/)
  assert.match(uomPage, /Existing equivalent reused/)
  assert.doesNotMatch(uomPage, /\.from\('uoms'\)[\s\S]{0,120}\.upsert\(/)
  assert.doesNotMatch(uomPage, /from\('uoms'\)[\s\S]{0,100}\.delete\(/)
})

test('global search runs independent domains concurrently and protects stale requests', async () => {
  const search = await read('src/pages/SearchResults.tsx')

  assert.match(search, /await Promise\.all\(\[/)
  assert.equal((search.match(/\.abortSignal\(controller\.signal\)/g) || []).length, 7)
  assert.match(search, /requestId !== requestSequence\.current/)
  assert.match(search, /Some categories could not be searched/)
  assert.doesNotMatch(search, /const \{ data: items[\s\S]{0,200}await supabase/)
})

test('legacy notifications are normalised without exposing invalid destinations', async () => {
  const [presentation, navigation, page, centre] = await Promise.all([
    read('src/lib/notificationPresentation.ts'),
    read('src/lib/notificationNavigation.ts'),
    read('src/pages/Notifications.tsx'),
    read('src/components/notifications/NotificationCenter.tsx'),
  ])

  assert.match(presentation, /formatLegacyNotificationBody/)
  assert.match(presentation, /safeNotificationActionUrl/)
  assert.match(presentation, /\/cash\/approvals/)
  assert.match(page, /safeNotificationActionUrl\(row\.action_url \|\| row\.url\)/)
  assert.match(page, /prepareNotificationNavigation\(/)
  assert.match(centre, /safeNotificationActionUrl\(n\.url\)/)
  assert.match(centre, /prepareNotificationNavigation\(/)
  assert.match(navigation, /const safeUrl = safeNotificationActionUrl\(actionUrl\)/)
  assert.match(navigation, /await verifyCompanyAccess\(targetCompanyId, activeUserId\)/)
  assert.match(navigation, /await setActiveCompany\(targetCompanyId\)/)
})

test('Opening Import labels the file control and avoids zero summaries before preview', async () => {
  const openingImport = await read('src/pages/OpeningImport.tsx')

  assert.match(openingImport, /<Label htmlFor=\{`opening-import-file-/)
  assert.match(openingImport, /\{preview \? \(\s*<OperationalSummaryBand/)
  assert.doesNotMatch(openingImport, /\{preview\?\.rows\.length \|\| 0\}/)
  assert.match(openingImport, /border-status-warning-border bg-status-warning-muted/)
})

test('superseded Reports implementation is absent and the maintained route remains', async () => {
  const app = await read('src/App.tsx')
  assert.match(app, /\.\/pages\/Reports/)
  assert.doesNotMatch(app, /\.\/pages\/reports\//)

  const reportsDirectory = new URL('../../src/pages/reports', import.meta.url)
  const entries = await readdir(reportsDirectory, { recursive: true }).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  assert.deepEqual(entries.filter((entry) => /\.[cm]?[jt]sx?$/.test(entry)), [])
})

test('administration surfaces do not use direct status colours', async () => {
  const sources = await Promise.all([
    'src/pages/Settings.tsx',
    'src/pages/Users.tsx',
    'src/pages/UomSettings.tsx',
    'src/pages/SearchResults.tsx',
    'src/pages/OpeningImport.tsx',
  ].map(read))

  for (const source of sources) {
    assert.doesNotMatch(source, /(?:bg|text|border)-(?:red|rose|amber|yellow|green|emerald|blue|purple)-\d/)
  }
})
