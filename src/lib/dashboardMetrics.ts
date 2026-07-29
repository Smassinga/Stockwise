export type DashboardCostState = 'supported' | 'explicit_zero' | 'partial' | 'unavailable' | 'not_applicable'

export type DashboardPeriodPreset = 'today' | 'week' | 'month' | 'custom'
export type DashboardDateRange = { start: string; end: string; compareStart: string; compareEnd: string }

const DASHBOARD_DAY_MS = 86_400_000
const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const dateAtNoon = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}
const shiftDays = (value: Date, days: number) => new Date(value.getTime() + days * DASHBOARD_DAY_MS)

export function dashboardPeriodRange(
  preset: DashboardPeriodPreset,
  today = new Date(),
  customStart?: string,
  customEnd?: string,
): DashboardDateRange | null {
  const anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
  let start = anchor
  let end = anchor
  if (preset === 'week') start = shiftDays(anchor, -((anchor.getDay() + 6) % 7))
  if (preset === 'month') start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12)
  if (preset === 'custom') {
    if (!customStart || !customEnd || customEnd < customStart) return null
    start = dateAtNoon(customStart)
    end = dateAtNoon(customEnd)
  }
  const elapsedDays = Math.round((end.getTime() - start.getTime()) / DASHBOARD_DAY_MS)
  let compareEnd = shiftDays(start, -1)
  let compareStart = shiftDays(compareEnd, -elapsedDays)
  if (preset === 'week') {
    compareStart = shiftDays(start, -7)
    compareEnd = shiftDays(end, -7)
  }
  if (preset === 'month') {
    compareStart = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1, 12)
    const previousMonthEnd = new Date(anchor.getFullYear(), anchor.getMonth(), 0, 12)
    compareEnd = new Date(anchor.getFullYear(), anchor.getMonth() - 1, Math.min(anchor.getDate(), previousMonthEnd.getDate()), 12)
  }
  return {
    start: localDate(start),
    end: localDate(end),
    compareStart: localDate(compareStart),
    compareEnd: localDate(compareEnd),
  }
}

export const dashboardCompletionRate = (completed: number, eligible: number) =>
  eligible > 0 ? completed / eligible * 100 : null
export const dashboardAverageTransaction = (sales: number, transactions: number) =>
  transactions > 0 ? sales / transactions : null

export type DashboardMovementCost = {
  qty_base: number | null
  unit_cost: number | null
  total_value: number | null
}

export type DashboardShipmentCost = {
  so_id?: string | null
  item_id: string
  qty_base: number | null
  movement_id: string | null
}

export type MovementCostEvidence = {
  available: boolean
  explicitZero: boolean
  amount: number
}

export type CostCoverage = {
  state: DashboardCostState
  knownAmount: number
  supportedCount: number
  missingCount: number
  explicitZeroCount: number
}

const finiteNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const dashboardCostKey = (scopeId: string, itemId: string) => `${scopeId}\u0000${itemId}`

export function resolveMovementCost(
  movement: DashboardMovementCost | undefined,
  fallbackQty?: number | null,
): MovementCostEvidence {
  if (!movement) return { available: false, explicitZero: false, amount: 0 }

  const totalValue = finiteNumber(movement.total_value)
  if (totalValue !== null) {
    return {
      available: true,
      explicitZero: totalValue === 0,
      amount: totalValue,
    }
  }

  const unitCost = finiteNumber(movement.unit_cost)
  const movementQty = finiteNumber(movement.qty_base)
  const quantity = movementQty ?? finiteNumber(fallbackQty)
  if (unitCost === null || quantity === null) {
    return { available: false, explicitZero: false, amount: 0 }
  }

  const amount = unitCost * quantity
  return {
    available: true,
    explicitZero: amount === 0,
    amount,
  }
}

export function summarizeCostCoverage(
  shipments: DashboardShipmentCost[],
  movements: Map<string, DashboardMovementCost>,
  expectedCostKeys: Iterable<string>,
): CostCoverage {
  const expected = new Set(expectedCostKeys)
  const shipmentsByCostKey = new Map<string, DashboardShipmentCost[]>()

  for (const shipment of shipments) {
    const costKey = dashboardCostKey(shipment.so_id || 'unscoped', shipment.item_id)
    const rows = shipmentsByCostKey.get(costKey) || []
    rows.push(shipment)
    shipmentsByCostKey.set(costKey, rows)
  }

  if (expected.size === 0 && shipments.length === 0) {
    return {
      state: 'not_applicable',
      knownAmount: 0,
      supportedCount: 0,
      missingCount: 0,
      explicitZeroCount: 0,
    }
  }

  for (const costKey of shipmentsByCostKey.keys()) expected.add(costKey)

  let knownAmount = 0
  let supportedCount = 0
  let missingCount = 0
  let explicitZeroCount = 0

  for (const costKey of expected) {
    const rows = shipmentsByCostKey.get(costKey) || []
    if (rows.length === 0) {
      missingCount += 1
      continue
    }

    for (const shipment of rows) {
      const movement = shipment.movement_id ? movements.get(shipment.movement_id) : undefined
      const evidence = resolveMovementCost(movement, shipment.qty_base)
      if (!evidence.available) {
        missingCount += 1
        continue
      }
      knownAmount += evidence.amount
      supportedCount += 1
      if (evidence.explicitZero) explicitZeroCount += 1
    }
  }

  let state: DashboardCostState
  if (missingCount > 0 && supportedCount > 0) state = 'partial'
  else if (missingCount > 0) state = 'unavailable'
  else if (supportedCount > 0 && explicitZeroCount === supportedCount) state = 'explicit_zero'
  else state = 'supported'

  return { state, knownAmount, supportedCount, missingCount, explicitZeroCount }
}

export function allocateTotalByWeights<T extends string>(
  total: number,
  weights: Map<T, number>,
): Map<T, number> {
  const positiveEntries = Array.from(weights.entries()).map(([key, value]) => [key, Math.max(0, value)] as const)
  const weightTotal = positiveEntries.reduce((sum, [, weight]) => sum + weight, 0)
  const result = new Map<T, number>()

  if (positiveEntries.length === 0) return result

  const divisor = weightTotal > 0 ? weightTotal : positiveEntries.length
  for (const [key, weight] of positiveEntries) {
    result.set(key, total * (weightTotal > 0 ? weight / divisor : 1 / divisor))
  }
  return result
}

export function valuesReconcile(left: number, right: number, tolerance = 0.005) {
  return Math.abs(left - right) < tolerance
}
