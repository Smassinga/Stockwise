import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const salesOrders = await readFile(new URL('../../src/pages/Orders/SalesOrders.tsx', import.meta.url), 'utf8')
const migration = await readFile(
  new URL('../../supabase/migrations/20260916180500_sync_service_job_sales_line_fulfilment.sql', import.meta.url),
  'utf8',
)

test('service sales lines are excluded from warehouse stock-source planning', () => {
  assert.match(
    salesOrders,
    /line\.so_id === selectedSO\.id && remaining\(line\) > 0 && itemById\.get\(line\.item_id\)\?\.primaryRole !== 'service'/,
  )
})

test('batch stock issue excludes service lines', () => {
  assert.match(
    salesOrders,
    /line\.so_id === so\.id && remaining\(line\) > 0 && itemById\.get\(line\.item_id\)\?\.primaryRole !== 'service'/,
  )
})

test('service lines cannot be posted through the stock shipment action', () => {
  assert.match(salesOrders, /primaryRole === 'service'/)
  assert.match(salesOrders, /Service lines are fulfilled through Service Jobs, not warehouse issue\./)
})

test('warehouse allocation UI is driven only by inventory open lines', () => {
  assert.match(salesOrders, /const selectedSOInventoryOpenLines = useMemo/)
  assert.match(salesOrders, /selectedSOInventoryOpenLines\.map\(l =>/)
  assert.match(salesOrders, /selectedSOInventoryOpenLines\.length > 0 && \(/)
})

test('service job completion mirrors fulfilment without stock movements', () => {
  assert.match(migration, /new\.execution_status = 'completed'/)
  assert.match(migration, /set shipped_qty = sol\.qty,/)
  assert.match(migration, /is_shipped = true,/)
  assert.match(migration, /old\.execution_status = 'completed'/)
  assert.match(migration, /new\.execution_status = 'in_progress'/)
  assert.match(migration, /set shipped_qty = 0,/)
  assert.doesNotMatch(migration, /insert\s+into\s+public\.stock_movements/i)
})
