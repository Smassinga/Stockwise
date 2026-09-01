import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('domain registers use open summaries and do not repeat workflow navigation in detail', async () => {
  const [bom, production, growth, service] = await Promise.all([
    read('src/pages/BOM.tsx'),
    read('src/pages/ProductionRuns.tsx'),
    read('src/pages/GrowthBatches.tsx'),
    read('src/pages/ServiceJobs.tsx'),
  ])

  for (const source of [bom, production, growth, service]) {
    assert.match(source, /<OperationalSummaryBand/)
  }
  assert.match(bom, /view === 'register' \? <ProductionPathGuide \/> : null/)
  assert.match(production, /view === 'register' \? <ProductionPathGuide \/> : null/)
  assert.match(growth, /view === 'register' \? <ProductionPathGuide \/> : null/)
  assert.doesNotMatch(service, /serviceJobs\.subtitle/)
})

test('BOM operational quantities use the shared quantity display contract', async () => {
  const bom = await read('src/pages/BOM.tsx')

  assert.match(bom, /formatOperationalQuantity\(row\.required/)
  assert.match(bom, /formatOperationalQuantity\(row\.available/)
  assert.match(bom, /formatOperationalQuantity\(row\.shortage/)
  assert.doesNotMatch(bom, /row\.(?:required|available|shortage)\.toLocaleString\([^)]*maximumFractionDigits: 2/)
})

test('Service Jobs distinguish filters, loading failures, and unavailable cost evidence', async () => {
  const service = await read('src/pages/ServiceJobs.tsx')

  assert.match(service, /useState\('all'\)/)
  assert.match(service, /jobs\.length \? tt\('serviceJobs\.filteredEmpty'/)
  assert.match(service, /detailLoading \? <PremiumSkeleton/)
  assert.match(service, /detailError \? \(/)
  assert.match(service, /summary \? <Card>/)
  assert.match(service, /serviceJobs\.costUnavailable/)
  assert.match(service, /setError\(readError \? tt\('serviceJobs\.loadFailed'/)
})

test('Landed Cost does not present calculated zeros before a source is selected', async () => {
  const landed = await read('src/pages/LandedCost.tsx')

  assert.match(landed, /!selectedOrder \? \(/)
  assert.match(landed, /landedCost\.noSourceTitle/)
  assert.match(landed, /selectedOrder \? <Card className="border-border\/80 shadow-sm">/)
  assert.doesNotMatch(landed, /landedCost\.eyebrow/)
})

test('production, growth, service, and landed-cost pages use semantic tokens instead of direct status colours', async () => {
  const sources = await Promise.all([
    'src/pages/BOM.tsx',
    'src/pages/ProductionRuns.tsx',
    'src/pages/GrowthBatches.tsx',
    'src/pages/ServiceJobs.tsx',
    'src/pages/LandedCost.tsx',
  ].map(read))

  for (const source of sources) {
    assert.doesNotMatch(source, /(?:bg|text|border)-(?:red|rose|amber|yellow|green|emerald|blue|purple)-\d/)
  }
})

test('presentation remediation leaves posting and allocation authorities in place', async () => {
  const [bom, production, growth, service, landed] = await Promise.all([
    read('src/pages/BOM.tsx'),
    read('src/pages/ProductionRuns.tsx'),
    read('src/pages/GrowthBatches.tsx'),
    read('src/pages/ServiceJobs.tsx'),
    read('src/pages/LandedCost.tsx'),
  ])

  assert.match(bom, /supabase\.rpc\('post_build_from_bom'/)
  assert.match(production, /supabase\.rpc\('post_production_run'/)
  assert.match(growth, /supabase\.rpc\('transfer_growth_batch'/)
  assert.match(growth, /supabase\.rpc\('complete_growth_batch'/)
  assert.match(service, /supabase\.rpc\(name, args\)/)
  assert.match(landed, /supabase\.rpc\('apply_landed_cost_run'/)
})
