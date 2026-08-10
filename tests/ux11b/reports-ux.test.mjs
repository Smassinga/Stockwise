import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Reports keeps the authoritative RPC contract and does not expose raw errors', async () => {
  const source = await read('src/pages/Reports.tsx')

  assert.match(source, /supabase\.rpc\('get_operational_report'/)
  assert.match(source, /p_warehouse_id: null, p_customer_id: null, p_include_cash: true, p_slow_days: 90/)
  assert.match(source, /console\.error\('\[Reports\] Report request failed'/)
  assert.match(source, /<PremiumStatePanel kind="error" title=\{copy\.loadFailed\}/)
  assert.match(source, /setReload\(\(value\) => value \+ 1\)/)
  assert.doesNotMatch(source, /setError\(rpcError\.message\)|>\{(?:error|rpcError\.message)\}</)
})

test('Reports distinguishes period, current snapshot, filtered empty, and no-activity states', async () => {
  const source = await read('src/pages/Reports.tsx')

  assert.match(source, /const periodReports = new Set<ReportCode>/)
  assert.doesNotMatch(source.match(/const periodReports[\s\S]*?\]\)/)?.[0] || '', /inventory-valuation|inventory-ageing/)
  assert.match(source, /copy\.noFilterResults/)
  assert.match(source, /copy\.noPeriodActivity/)
  assert.match(source, /copy\.noSnapshotData/)
  assert.match(source, /activityKeys\.some/)
  assert.match(source, /payload\?\.summary && rows\.length > 0/)
})

test('Reports uses structural loading and accessible dense table containment', async () => {
  const source = await read('src/pages/Reports.tsx')

  assert.match(source, /<PremiumSkeleton variant="table" rows=\{6\}/)
  assert.match(source, /role="region" aria-label=\{copy\.tableRegion\} tabIndex=\{0\}/)
  assert.match(source, /<caption className="sr-only">/)
  assert.match(source, /scope="col"/)
  assert.match(source, /text-right font-mono tabular-nums/)
  assert.match(source, /reportColumnOrder/)
  assert.match(source, /rowKey\(row, index\)/)
  assert.match(source, /quantityFields\.has\(key\)\) return formatOperationalQuantity\(value, locale\)/)
})

test('Reports exports the visible filter scope and provides local progress and failure states', async () => {
  const source = await read('src/pages/Reports.tsx')

  assert.match(source, /collectionStatus\}: \$\{activeCollectionLabel\}/)
  assert.match(source, /filters: filterLines, rows/)
  assert.match(source, /company\.companyName/)
  assert.match(source, /setExporting\(format\)/)
  assert.match(source, /exporting === 'csv'/)
  assert.match(source, /setExportFailed\(true\)/)
  assert.match(source, /escapeHtml\(formatValue/)
})

test('Reports discovery is restrained and uses canonical semantic classes', async () => {
  const source = await read('src/pages/Reports.tsx')

  assert.match(source, /<nav aria-label=\{copy\.report\}/)
  assert.match(source, /<PremiumRegisterHeader title=\{copy\.title\}/)
  assert.match(source, /'Cash Customer': 'Cliente a dinheiro'/)
  assert.match(source, /issue: 'Saída', receive: 'Entrada'/)
  assert.doesNotMatch(source, /from '\.\.\/components\/ui\/card'/)
  assert.doesNotMatch(source, /bg-gradient|hover:-translate|animate-pulse/)
  assert.doesNotMatch(source, /(?:bg|text|border)-(?:red|rose|amber|yellow|green|emerald|blue|purple)-\d/)
  assert.doesNotMatch(source, /Authoritative operational answers|Respostas operacionais autoritativas/)
})
