import { normalizeOperationalQuantity } from './operationalQuantity.ts'

export type OpeningStockPayloadInput = {
  itemId: string
  uomId: string
  quantity: number
  baseQuantity: number
  unitCost: number
  warehouseId: string
  binId: string
  notes: string | null
}

export type OpeningStockPostingRow = {
  item_id: string
  uom_id: string
  qty: number
  qty_base: number
  unit_cost: number
  total_value: number
  warehouse_to_id: string
  bin_to_id: string
  notes: string | null
}

export function roundOpeningStockMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function toOpeningStockPostingRow(input: OpeningStockPayloadInput): OpeningStockPostingRow {
  const quantity = normalizeOperationalQuantity(input.quantity)
  const baseQuantity = normalizeOperationalQuantity(input.baseQuantity)

  return {
    item_id: input.itemId,
    uom_id: input.uomId,
    qty: quantity,
    qty_base: baseQuantity,
    unit_cost: input.unitCost,
    total_value: roundOpeningStockMoney(baseQuantity * input.unitCost),
    warehouse_to_id: input.warehouseId,
    bin_to_id: input.binId,
    notes: input.notes,
  }
}
