import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  roundOpeningStockMoney,
  toOpeningStockPostingRow,
} from '../../src/lib/openingStockImport.ts'
import {
  normalizeOperationalQuantity,
  OPERATIONAL_QUANTITY_DECIMAL_PLACES,
} from '../../src/lib/operationalQuantity.ts'
import { buildConvGraph, tryConvertQty } from '../../src/lib/uom.ts'

function payloadFor(quantity, unitCost = 50) {
  return toOpeningStockPostingRow({
    itemId: 'opening-item',
    uomId: 'uom-kg',
    quantity,
    baseQuantity: quantity,
    unitCost,
    warehouseId: 'warehouse',
    binId: 'bin',
    notes: 'Opening stock',
  })
}

test('1.375 KG remains exact from parsed quantity through the governed posting row', () => {
  const parsedQuantity = Number('1.375')
  const payload = payloadFor(parsedQuantity)

  assert.equal(OPERATIONAL_QUANTITY_DECIMAL_PLACES, 4)
  assert.equal(parsedQuantity, 1.375)
  assert.equal(payload.qty, 1.375)
  assert.equal(payload.qty_base, 1.375)
  assert.equal(payload.total_value, 68.75)
})

test('the existing four-decimal operational boundary applies to source and converted base quantity', () => {
  const graph = buildConvGraph([{ from_uom_id: 'source-uom', to_uom_id: 'base-uom', factor: 1 / 3 }])
  const convertedQuantity = tryConvertQty(1.375, 'source-uom', 'base-uom', graph)
  assert.notEqual(convertedQuantity, null)

  const payload = toOpeningStockPostingRow({
    itemId: 'converted-item',
    uomId: 'source-uom',
    quantity: 1.375,
    baseQuantity: convertedQuantity,
    unitCost: 2,
    warehouseId: 'warehouse',
    binId: 'bin',
    notes: null,
  })

  assert.equal(normalizeOperationalQuantity(1.23456), 1.2346)
  assert.equal(payload.qty, 1.375)
  assert.equal(payload.qty_base, 0.4583)
})

test('whole and two-decimal operational quantities remain stable', () => {
  assert.equal(payloadFor(10).qty_base, 10)
  assert.equal(payloadFor(2.5).qty_base, 2.5)
})

test('opening-stock money remains independently rounded to two decimals', () => {
  const payload = payloadFor(1.375, 50.555)

  assert.equal(payload.qty_base, 1.375)
  assert.equal(payload.unit_cost, 50.555)
  assert.equal(payload.total_value, 69.51)
  assert.equal(roundOpeningStockMoney(10.005), 10.01)
})

test('Opening Import delegates payload quantity handling to the operational helper', async () => {
  const openingImport = await readFile(new URL('../../src/pages/OpeningImport.tsx', import.meta.url), 'utf8')

  assert.match(openingImport, /toOpeningStockPostingRow\(\{/)
  assert.doesNotMatch(openingImport, /qty_base:\s*round2\(/)
  assert.doesNotMatch(openingImport, /total_value:\s*round2\(/)
})
