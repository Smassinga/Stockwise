type RefRow = {
  ref_type?: string | null
  ref_id?: string | null
}

export type FinanceReferenceMap = Record<string, string>

const referenceKey = (refType: string, refId: string) => `${refType}:${refId}`

export async function fetchFinanceReferenceMap(
  client: any,
  companyId: string | null | undefined,
  refs: RefRow[],
) {
  if (!companyId) return {} as FinanceReferenceMap
  const idsFor = (type: string) => Array.from(new Set(
    refs
      .filter((row) => row.ref_type === type && row.ref_id)
      .map((row) => row.ref_id as string),
  ))
  const soIds = idsFor('SO')
  const poIds = idsFor('PO')
  const siIds = idsFor('SI')
  const vbIds = idsFor('VB')
  const crIds = idsFor('CR')

  if (![soIds, poIds, siIds, vbIds, crIds].some((ids) => ids.length)) {
    return {} as FinanceReferenceMap
  }

  const [soRes, poRes, siRes, vbRes, crRes] = await Promise.all([
    soIds.length ? client.from('sales_orders').select('id,order_no').eq('company_id', companyId).in('id', soIds) : Promise.resolve({ data: [], error: null }),
    poIds.length ? client.from('purchase_orders').select('id,order_no').eq('company_id', companyId).in('id', poIds) : Promise.resolve({ data: [], error: null }),
    siIds.length ? client.from('sales_invoices').select('id,internal_reference').eq('company_id', companyId).in('id', siIds) : Promise.resolve({ data: [], error: null }),
    vbIds.length ? client.from('vendor_bills').select('id,internal_reference,supplier_invoice_reference').eq('company_id', companyId).in('id', vbIds) : Promise.resolve({ data: [], error: null }),
    crIds.length ? client.from('customer_receipts').select('id,receipt_reference').eq('company_id', companyId).in('id', crIds) : Promise.resolve({ data: [], error: null }),
  ])

  for (const result of [soRes, poRes, siRes, vbRes, crRes]) {
    if (result.error) throw result.error
  }

  const map: FinanceReferenceMap = {}
  for (const row of soRes.data || []) map[referenceKey('SO', row.id)] = row.order_no || row.id
  for (const row of poRes.data || []) map[referenceKey('PO', row.id)] = row.order_no || row.id
  for (const row of siRes.data || []) map[referenceKey('SI', row.id)] = row.internal_reference || row.id
  for (const row of vbRes.data || []) map[referenceKey('VB', row.id)] = row.supplier_invoice_reference || row.internal_reference || row.id
  for (const row of crRes.data || []) map[referenceKey('CR', row.id)] = row.receipt_reference || row.id
  return map
}

export function formatFinanceReference(
  refType: string | null | undefined,
  refId: string | null | undefined,
  referenceByKey: FinanceReferenceMap,
  fallback = '—',
) {
  const type = String(refType || '')
  const id = String(refId || '')
  if (!type) return fallback
  if (!id) return type
  if (['SO', 'PO', 'SI', 'VB', 'CR'].includes(type)) {
    const reference = referenceByKey[referenceKey(type, id)]
    return reference ? `${type} ${reference}` : `${type} ${id.slice(0, 8)}`
  }
  return `${type} ${id.slice(0, 8)}`
}
