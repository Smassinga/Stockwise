export type AssemblyTimeUnit = 'minutes' | 'hours'

export type AssemblyPlanningProfile = {
  minutesPerUnit: number | null
  setupMinutes: number | null
}

export type AssemblyPlanningEstimate = {
  requestedQty: number
  stockCapacityQty: number
  stockShortageCount: number
  timeConfigured: boolean
  availableTimeConfigured: boolean
  totalRequiredMinutes: number | null
  availableMinutes: number | null
  timeCapacityQty: number | null
  effectiveCapacityQty: number
  requestedWithinStock: boolean
  requestedWithinTime: boolean | null
  planningStatus:
    | 'ready'
    | 'stock_limited'
    | 'time_limited'
    | 'stock_and_time_limited'
    | 'time_not_configured'
    | 'time_not_configured_and_stock_limited'
  limitingFactor: 'none' | 'stock' | 'time' | 'stock_and_time' | 'time_not_configured'
}

const HOURS_TO_MINUTES = 60

export function normalizeTimeValueToMinutes(
  rawValue: string | number | null | undefined,
  unit: AssemblyTimeUnit,
): number | null {
  if (rawValue == null || rawValue === '') return null
  const value = Number(rawValue)
  if (!Number.isFinite(value)) return null
  if (value < 0) return null
  return unit === 'hours' ? value * HOURS_TO_MINUTES : value
}

export function durationInputFromMinutes(minutes: number | null | undefined): {
  value: string
  unit: AssemblyTimeUnit
} {
  const numeric = Number(minutes)
  if (!Number.isFinite(numeric) || numeric <= 0) return { value: '', unit: 'minutes' }
  if (numeric % HOURS_TO_MINUTES === 0) {
    return { value: String(numeric / HOURS_TO_MINUTES), unit: 'hours' }
  }
  return { value: String(Number(numeric.toFixed(2))), unit: 'minutes' }
}

export function formatDurationFromMinutes(
  minutes: number | null | undefined,
  labels: {
    hourShort: string
    minuteShort: string
    zero: string
  },
): string {
  const numeric = Number(minutes)
  if (!Number.isFinite(numeric) || numeric <= 0) return labels.zero

  const wholeHours = Math.floor(numeric / HOURS_TO_MINUTES)
  const remainingMinutes = Number((numeric - wholeHours * HOURS_TO_MINUTES).toFixed(2))

  if (wholeHours > 0 && remainingMinutes > 0) {
    return `${wholeHours} ${labels.hourShort} ${remainingMinutes} ${labels.minuteShort}`
  }
  if (wholeHours > 0 && remainingMinutes === 0) {
    return `${wholeHours} ${labels.hourShort}`
  }
  return `${Number(numeric.toFixed(2))} ${labels.minuteShort}`
}

export function calculateAssemblyPlanningEstimate(args: {
  requestedQty: number
  stockCapacityQty: number
  stockShortageCount: number
  minutesPerUnit: number | null
  setupMinutes: number | null
  availableMinutes: number | null
}): AssemblyPlanningEstimate {
  const requestedQty = Number.isFinite(args.requestedQty) ? Math.max(args.requestedQty, 0) : 0
  const stockCapacityQty = Number.isFinite(args.stockCapacityQty) ? Math.max(args.stockCapacityQty, 0) : 0
  const stockShortageCount = Number.isFinite(args.stockShortageCount) ? Math.max(args.stockShortageCount, 0) : 0
  const minutesPerUnit = Number.isFinite(args.minutesPerUnit) ? Number(args.minutesPerUnit) : null
  const setupMinutes = Number.isFinite(args.setupMinutes) ? Math.max(Number(args.setupMinutes), 0) : null
  const availableMinutes = Number.isFinite(args.availableMinutes) ? Math.max(Number(args.availableMinutes), 0) : null

  const timeConfigured = minutesPerUnit != null && minutesPerUnit > 0
  const availableTimeConfigured = availableMinutes != null
  const totalRequiredMinutes = timeConfigured
    ? (setupMinutes ?? 0) + requestedQty * minutesPerUnit
    : null

  let timeCapacityQty: number | null = null
  if (timeConfigured && availableTimeConfigured) {
    const usableMinutes = Math.max(availableMinutes - (setupMinutes ?? 0), 0)
    timeCapacityQty = Number((usableMinutes / minutesPerUnit).toFixed(2))
  }

  const requestedWithinStock = requestedQty <= stockCapacityQty
  const requestedWithinTime = timeCapacityQty == null ? null : requestedQty <= timeCapacityQty

  let effectiveCapacityQty = stockCapacityQty
  if (timeCapacityQty != null) {
    effectiveCapacityQty = Math.max(Math.min(stockCapacityQty, timeCapacityQty), 0)
  }

  const stockLimited = !requestedWithinStock
  const timeLimited = requestedWithinTime === false

  let planningStatus: AssemblyPlanningEstimate['planningStatus']
  let limitingFactor: AssemblyPlanningEstimate['limitingFactor']

  if (!timeConfigured) {
    planningStatus = stockLimited ? 'time_not_configured_and_stock_limited' : 'time_not_configured'
    limitingFactor = stockLimited ? 'stock' : 'time_not_configured'
  } else if (stockLimited && timeLimited) {
    planningStatus = 'stock_and_time_limited'
    limitingFactor = 'stock_and_time'
  } else if (stockLimited) {
    planningStatus = 'stock_limited'
    limitingFactor = 'stock'
  } else if (timeLimited) {
    planningStatus = 'time_limited'
    limitingFactor = 'time'
  } else {
    planningStatus = 'ready'
    limitingFactor = 'none'
  }

  return {
    requestedQty,
    stockCapacityQty,
    stockShortageCount,
    timeConfigured,
    availableTimeConfigured,
    totalRequiredMinutes,
    availableMinutes,
    timeCapacityQty,
    effectiveCapacityQty: Number(effectiveCapacityQty.toFixed(2)),
    requestedWithinStock,
    requestedWithinTime,
    planningStatus,
    limitingFactor,
  }
}
