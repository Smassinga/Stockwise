export function roundFinanceAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function parseFinanceDraftNumber(value: string) {
  const normalized = String(value || '').replace(',', '.').trim()
  if (!normalized) return 0
  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? numeric : 0
}

export function formatFinanceDraftNumber(value: number, digits = 2) {
  if (value <= 0) return ''
  const fixed = value.toFixed(digits)
  return fixed.replace(/\.00$/, '').replace(/(\.\d*?)0+$/, '$1')
}
