import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('shared authenticated headers use open hierarchy instead of a default card surface', async () => {
  const [pageHeader, registerHeader] = await Promise.all([
    read('src/components/premium/PremiumPageHeader.tsx'),
    read('src/components/premium/PremiumRegisterHeader.tsx'),
  ])

  assert.match(pageHeader, /border-b border-border pb-5/)
  assert.doesNotMatch(pageHeader, /bg-surface-elevated|shadow-\[/)
  assert.match(registerHeader, /border-b border-border pb-5/)
  assert.doesNotMatch(registerHeader, /premium-label|bg-surface-elevated|shadow-\[/)
})

test('shared table and mobile register errors retain error semantics', async () => {
  const [table, mobileList] = await Promise.all([
    read('src/components/premium/PremiumDataTable.tsx'),
    read('src/components/premium/PremiumMobileCardList.tsx'),
  ])

  assert.match(table, /<PremiumStatePanel\s+kind="error"/)
  assert.match(mobileList, /<PremiumStatePanel kind="error"/)
})

test('global search routes register results to real routes with a useful filter', async () => {
  const [search, items, customers, suppliers] = await Promise.all([
    read('src/pages/SearchResults.tsx'),
    read('src/pages/Items.tsx'),
    read('src/pages/Customers.tsx'),
    read('src/pages/Suppliers.tsx'),
  ])

  assert.doesNotMatch(search, /`\/(items|customers|suppliers)\/\$\{/)
  assert.match(search, /`\/items\?q=/)
  assert.match(search, /`\/customers\?q=/)
  assert.match(search, /`\/suppliers\?q=/)
  assert.match(search, /<PremiumSkeleton variant="list"/)
  assert.match(search, /kind="error"/)
  assert.match(items, /useState\(searchParams\.get\('q'\) \|\| ''\)/)
  assert.match(items, /<DialogTitle>\{tt\('items\.deleteTitle', 'Delete item\?'\)\}<\/DialogTitle>/)
  assert.match(items, /This action cannot be undone/)
  assert.doesNotMatch(items, /onClick=\{\(\) => handleDelete\(item\.id\)\}/)
  assert.match(customers, /useState\(searchParams\.get\('q'\) \|\| ''\)/)
  assert.match(suppliers, /useState\(searchParams\.get\('q'\) \|\| ''\)/)
})

test('notifications use labelled filters, structural loading, and semantic state tokens', async () => {
  const [page, center] = await Promise.all([
    read('src/pages/Notifications.tsx'),
    read('src/components/notifications/NotificationCenter.tsx'),
  ])

  assert.match(page, /aria-label=\{copy\.categoryLabel\}/)
  assert.match(page, /aria-label=\{copy\.stateLabel\}/)
  assert.match(page, /<PremiumSkeleton variant="list"/)
  assert.match(page, /<PremiumStatusBadge/)
  assert.match(page, /\.in\('id', unreadIds\)/)
  assert.doesNotMatch(page, /bg-primary\/5|bg-red-|bg-amber-|bg-rose-/)
  assert.match(center, /border-status-warning-border/)
  assert.match(center, /border-status-danger-border/)
  assert.doesNotMatch(center, /bg-red-600|bg-amber-500|bg-rose-500/)
})

test('POS, opening import, reports, and Dashboard expose direct user language', async () => {
  const [operator, openingImport, reports, dashboard] = await Promise.all([
    read('src/pages/Operator.tsx'),
    read('src/pages/OpeningImport.tsx'),
    read('src/pages/Reports.tsx'),
    read('src/pages/Dashboard.tsx'),
  ])

  assert.match(operator, /<h1>\{copy\.title\}<\/h1>/)
  assert.match(openingImport, /<h1>\{copy\.title\}<\/h1>/)
  assert.doesNotMatch(reports, /premium-label">OPS-1/)
  assert.match(dashboard, /`movements\.type\.\$\{movement\.type\}`/)
  assert.doesNotMatch(dashboard, /`movement\.\$\{movement\.type\}`/)
})

test('Profile keeps Auth metadata authoritative without warning on an expected optional mirror denial', async () => {
  const profile = await read('src/pages/Profile.tsx')

  assert.match(profile, /Optional Profile mirror write skipped; Auth metadata remains authoritative/)
  assert.doesNotMatch(profile, /console\.warn\('Profile table write blocked/)
  assert.match(profile, /supabase\.auth\.updateUser/)
})
