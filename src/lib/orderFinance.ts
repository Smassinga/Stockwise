export type SettlementKind = 'SO' | 'PO' | 'SI' | 'VB'

type LineLike = {
  qty?: number | null
  unit_price?: number | null
  unitPrice?: number | null
  discount_pct?: number | null
  discountPct?: number | null
  line_total?: number | null
  lineTotal?: number | null
}

type SalesOrderLike = {
  total_amount?: number | null
  tax_total?: number | null
  fx_to_base?: number | null
  fxToBase?: number | null
}

type PurchaseOrderLike = {
  subtotal?: number | null
  tax_total?: number | null
  total?: number | null
  fx_to_base?: number | null
  fxToBase?: number | null
}

const n = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const pad = (value: number) => String(value).padStart(2, '0')

export function toIsoDate(value?: string | null): string | null {
  if (!value) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null

  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]

  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return null

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDaysIso(baseDate: string, days: number): string {
  const date = new Date(`${baseDate}T00:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parsePaymentTermDays(terms?: string | null): number | null {
  if (!terms) return null
  const match = String(terms).match(/(-?\d+)/)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

export function deriveDueDate(options: {
  explicitDate?: string | null
  baseDate?: string | null
  fallbackDate?: string | null
  paymentTerms?: string | null
}) {
  const explicit = toIsoDate(options.explicitDate)
  if (explicit) return explicit

  const anchor = toIsoDate(options.baseDate) ?? toIsoDate(options.fallbackDate)
  const netDays = parsePaymentTermDays(options.paymentTerms)

  if (anchor && netDays !== null) return addDaysIso(anchor, netDays)
  return toIsoDate(options.fallbackDate) ?? anchor
}

export function daysOverdue(dueDate?: string | null, today = new Date()) {
  const due = toIsoDate(dueDate)
  if (!due) return 0
  const dueMs = new Date(`${due}T00:00:00`).getTime()
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const todayMs = new Date(`${todayIso}T00:00:00`).getTime()
  const diff = todayMs - dueMs
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0
}

export function discountedLineTotal(qty: number, unitPrice: number, discountPct = 0) {
  return n(qty) * n(unitPrice) * (1 - n(discountPct) / 100)
}

export function lineTotal(line: LineLike) {
  const stored = n(line.line_total ?? line.lineTotal, Number.NaN)
  if (Number.isFinite(stored)) return stored
  return discountedLineTotal(
    n(line.qty),
    n(line.unit_price ?? line.unitPrice),
    n(line.discount_pct ?? line.discountPct),
  )
}

export function salesOrderAmounts(order: SalesOrderLike, lines: LineLike[] = []) {
  const subtotalFromLines = lines.reduce((sum, line) => sum + lineTotal(line), 0)
  const headerSubtotal = n(order.total_amount, Number.NaN)
  const subtotal = Number.isFinite(headerSubtotal) ? headerSubtotal : subtotalFromLines
  const tax = n(order.tax_total, 0)
  const total = subtotal + tax
  const fx = n(order.fx_to_base ?? order.fxToBase, 1) || 1

  return {
    subtotal,
    tax,
    total,
    fx,
    subtotalBase: subtotal * fx,
    taxBase: tax * fx,
    totalBase: total * fx,
  }
}

export function purchaseOrderAmounts(order: PurchaseOrderLike, lines: LineLike[] = []) {
  const subtotalFromLines = lines.reduce((sum, line) => sum + lineTotal(line), 0)
  const headerSubtotal = n(order.subtotal, Number.NaN)
  const subtotal = Number.isFinite(headerSubtotal) ? headerSubtotal : subtotalFromLines
  const headerTotal = n(order.total, Number.NaN)
  const taxFallback = Number.isFinite(headerTotal) ? Math.max(0, headerTotal - subtotal) : 0
  const tax = n(order.tax_total, taxFallback)
  const total = Number.isFinite(headerTotal) ? headerTotal : subtotal + tax
  const fx = n(order.fx_to_base ?? order.fxToBase, 1) || 1

  return {
    subtotal,
    tax,
    total,
    fx,
    subtotalBase: subtotal * fx,
    taxBase: tax * fx,
    totalBase: total * fx,
  }
}

export function normalizeSettledAmount(kind: SettlementKind, amountBase: number) {
  const signed = n(amountBase)
  return kind === 'SO' || kind === 'SI' ? signed : signed * -1
}

export function outstandingAmount(totalBase: number, settledBase: number) {
  return Math.max(0, n(totalBase) - n(settledBase))
}
