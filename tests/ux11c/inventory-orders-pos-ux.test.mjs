import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('inventory registers use restrained headers and open operational summaries', async () => {
  const [items, stock, movements, warehouses] = await Promise.all([
    read('src/pages/Items.tsx'),
    read('src/pages/StockLevels.tsx'),
    read('src/pages/StockMovements.tsx'),
    read('src/pages/Warehouses.tsx'),
  ])

  assert.doesNotMatch(items, /<PremiumMetricCard/)
  assert.doesNotMatch(movements, /<PremiumMetricCard/)
  assert.doesNotMatch(warehouses, /<PremiumMetricCard/)
  assert.match(stock, /aria-label=\{tt\('stock\.summary\.label'/)
  assert.match(warehouses, /<dl className="grid grid-cols-2 sm:grid-cols-4">/)
  assert.doesNotMatch(items, /Master data clarity|items\.subtitle/)
  assert.doesNotMatch(movements, /Warehouse control|movements\.subtitle/)
})

test('item creation persists the governed profile and normal editing stays minimum-stock only', async () => {
  const items = await read('src/pages/Items.tsx')

  assert.match(items, /supabase\.rpc\('create_item_with_profile'/)
  assert.match(items, /item_profile_roundtrip_mismatch/)
  assert.match(items, /item_profile_roundtrip_reload_failed/)
  assert.match(items, /\.update\(\{ min_stock: nextMinStock \}\)/)
  assert.doesNotMatch(items, /\.update\(\{[^}]*unit_price/)
  assert.match(items, /step="0\.0001"/)
})

test('orders suppress zero summary card walls and keep lifecycle logic outside the presentation change', async () => {
  const [shell, sales, purchases] = await Promise.all([
    read('src/pages/Orders.tsx'),
    read('src/pages/Orders/SalesOrders.tsx'),
    read('src/pages/Orders/PurchaseOrders.tsx'),
  ])

  assert.match(shell, /<PremiumSkeleton lines=\{6\}/)
  assert.match(sales, /soOutstanding\.length > 0/)
  assert.match(purchases, /poOutstanding\.length > 0/)
  assert.match(sales, /<OrderWorkflowStrip/)
  assert.match(purchases, /<OrderWorkflowStrip/)
})

test('scoped surfaces avoid new direct semantic colours and decorative motion', async () => {
  const sources = await Promise.all([
    'src/pages/Items.tsx',
    'src/pages/StockLevels.tsx',
    'src/pages/StockMovements.tsx',
    'src/pages/Warehouses.tsx',
    'src/pages/Customers.tsx',
    'src/pages/Suppliers.tsx',
    'src/pages/Orders.tsx',
    'src/pages/Operator.tsx',
  ].map(read))

  for (const source of sources) {
    assert.doesNotMatch(source, /(?:bg|text|border)-(?:red|rose|amber|yellow|green|emerald|blue|purple)-\d/)
    assert.doesNotMatch(source, /bg-gradient|hover:-translate|animate-pulse/)
  }
})

test('movement decimal controls expose labels, decimal keyboards, and base-unit context', async () => {
  const [movements, stock, items] = await Promise.all([
    read('src/pages/StockMovements.tsx'),
    read('src/pages/StockLevels.tsx'),
    read('src/pages/Items.tsx'),
  ])

  assert.match(movements, /htmlFor="movement-quantity"/)
  assert.match(movements, /id="movement-quantity" type="number" inputMode="decimal"/)
  assert.match(movements, /id="movement-uom"/)
  assert.match(movements, /step="0\.0001"/)
  assert.match(movements, /preview\.base/)
  assert.match(movements, /const fmtQty = .*maximumFractionDigits: 4/)
  assert.match(stock, /maximumFractionDigits: 4/)
  assert.match(items, /maximumFractionDigits: 4/)
})

test('POS preserves quantities with at least three decimal places before authoritative preview and posting', async () => {
  const [{ clampOperationalQuantity }, { toOperatorSaleRpcLines }] = await Promise.all([
    import('../../src/lib/operationalQuantity.ts'),
    import('../../src/lib/operatorSalePayload.ts'),
  ])

  const quantity = clampOperationalQuantity(1.375, 10)
  const [line] = toOperatorSaleRpcLines([{ itemId: 'weighted-item', qty: quantity, unitPrice: 120 }])

  assert.equal(quantity, 1.375)
  assert.equal(line.qty, 1.375)
  assert.equal(Math.round(line.qty * line.unit_price * 100) / 100, 165)
})
