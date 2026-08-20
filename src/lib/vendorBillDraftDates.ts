export type VendorBillPaymentTerm = {
  id: string
  net_days: number
}

const addCalendarDays = (baseDate: string, days: number) => {
  const date = new Date(`${baseDate}T00:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const paymentTermDays = (value?: string | null) => {
  const match = String(value || '').match(/(-?\d+)/)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

export function companyBusinessDateYmd(
  timeZone = 'Africa/Maputo',
  now = new Date(),
) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    if (values.year && values.month && values.day) {
      return `${values.year}-${values.month}-${values.day}`
    }
  } catch {
    // Company settings are user-maintained. A bad timezone must not copy a PO
    // date into a new bill; the local calendar date is the safe fallback.
  }

  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function vendorBillDraftDateDefaults(options: {
  timeZone?: string | null
  paymentTermsId?: string | null
  paymentTermsText?: string | null
  paymentTerms: VendorBillPaymentTerm[]
  now?: Date
}) {
  const billDate = companyBusinessDateYmd(
    options.timeZone || 'Africa/Maputo',
    options.now,
  )
  const selectedTerm = options.paymentTerms.find(
    (term) => term.id === options.paymentTermsId,
  )
  const parsedDays = paymentTermDays(options.paymentTermsText)
  const netDays = selectedTerm && Number.isFinite(Number(selectedTerm.net_days))
    ? Math.max(0, Number(selectedTerm.net_days))
    : parsedDays !== null
      ? Math.max(0, parsedDays)
      : 0

  return {
    supplierInvoiceDate: '',
    billDate,
    dueDate: addCalendarDays(billDate, netDays),
  }
}

export function validVendorBillDateSequence(billDate: string, dueDate: string) {
  return Boolean(billDate && dueDate && dueDate >= billDate)
}
