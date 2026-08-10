import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  clampOperationalQuantity,
  formatOperationalQuantity,
  MIN_OPERATIONAL_QUANTITY,
  normalizeOperationalQuantity,
  OPERATIONAL_QUANTITY_DECIMAL_PLACES,
  sumOperationalQuantities,
} from '../../src/lib/operationalQuantity.ts'
import { toOperatorSaleRpcLines } from '../../src/lib/operatorSalePayload.ts'

test('1.375 KG remains exact through cart normalization and RPC payload preparation', () => {
  const cartQuantity = clampOperationalQuantity(1.375, 10)
  const [payloadLine] = toOperatorSaleRpcLines([
    { itemId: 'weighted-item', qty: cartQuantity, unitPrice: 120 },
  ])

  assert.equal(OPERATIONAL_QUANTITY_DECIMAL_PLACES, 4)
  assert.equal(cartQuantity, 1.375)
  assert.equal(sumOperationalQuantities([cartQuantity]), 1.375)
  assert.deepEqual(payloadLine, {
    item_id: 'weighted-item',
    qty: 1.375,
    unit_price: 120,
  })
  assert.equal(Math.round((payloadLine.qty * payloadLine.unit_price) * 100) / 100, 165)
})

test('whole-unit POS quantities and two-decimal money remain unchanged', () => {
  const cartQuantity = clampOperationalQuantity(1, 10)
  const [payloadLine] = toOperatorSaleRpcLines([
    { itemId: 'whole-item', qty: cartQuantity, unitPrice: 100 },
  ])

  assert.equal(cartQuantity, 1)
  assert.equal(payloadLine.qty, 1)
  assert.equal(Math.round((payloadLine.qty * payloadLine.unit_price) * 100) / 100, 100)
})

test('the four-decimal quantity boundary is positive and availability-safe', () => {
  assert.equal(MIN_OPERATIONAL_QUANTITY, 0.0001)
  assert.equal(normalizeOperationalQuantity(0.0001), 0.0001)
  assert.equal(normalizeOperationalQuantity(0.00004), 0)
  assert.equal(clampOperationalQuantity(10.5, 10), 10)
  assert.equal(clampOperationalQuantity(-1, 10), 0)
  assert.equal(clampOperationalQuantity(Number.NaN, 10), 0)
})

test('display formatting does not mutate the operational quantity', () => {
  const quantity = normalizeOperationalQuantity(1.375)
  const display = formatOperationalQuantity(quantity)

  assert.equal(display, '1.375')
  assert.equal(quantity, 1.375)
})

test('POS quantity paths do not reuse the monetary rounding helper', async () => {
  const operator = await readFile(new URL('../../src/pages/Operator.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(operator, /roundMoney\(nextQty\)/)
  assert.doesNotMatch(operator, /roundMoney\(line\.qty\s*[+-]\s*1\)/)
  assert.match(operator, /clampOperationalQuantity\(nextQty, row\.availableQty\)/)
  assert.match(operator, /sumOperationalQuantities\(cart\.map\(\(line\) => line\.qty\)\)/)
  assert.match(operator, /step=\{MIN_OPERATIONAL_QUANTITY\}/)
})

test('downstream Dashboard movement evidence uses quantity precision, not the two-decimal count formatter', async () => {
  const dashboard = await readFile(new URL('../../src/pages/Dashboard.tsx', import.meta.url), 'utf8')

  assert.match(dashboard, /formatOperationalQuantity\(number\(movement\.qty_base\), locale\)/)
  assert.doesNotMatch(dashboard, /count\(number\(movement\.qty_base\)\)/)
})
