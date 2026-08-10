export const OPERATIONAL_QUANTITY_DECIMAL_PLACES = 4
export const MIN_OPERATIONAL_QUANTITY = 10 ** -OPERATIONAL_QUANTITY_DECIMAL_PLACES

const OPERATIONAL_QUANTITY_FACTOR = 10 ** OPERATIONAL_QUANTITY_DECIMAL_PLACES

export function normalizeOperationalQuantity(value: number) {
  if (!Number.isFinite(value)) return 0
  const normalized = Math.round((value + Number.EPSILON) * OPERATIONAL_QUANTITY_FACTOR)
    / OPERATIONAL_QUANTITY_FACTOR
  return Object.is(normalized, -0) ? 0 : normalized
}

export function clampOperationalQuantity(value: number, availableQuantity: number) {
  const normalized = Math.max(0, normalizeOperationalQuantity(value))
  const safeAvailable = Math.max(
    0,
    Math.floor((availableQuantity + Number.EPSILON) * OPERATIONAL_QUANTITY_FACTOR)
      / OPERATIONAL_QUANTITY_FACTOR,
  )
  return Math.min(normalized, safeAvailable)
}

export function sumOperationalQuantities(values: number[]) {
  return normalizeOperationalQuantity(values.reduce((sum, value) => sum + value, 0))
}

export function formatOperationalQuantity(value: number, locale = 'en-US') {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: OPERATIONAL_QUANTITY_DECIMAL_PLACES,
  }).format(value)
}
