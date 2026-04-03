import { interpolateMessage } from './i18n'

type RefRow = {
  ref_type?: string | null
  ref_id?: string | null
}

type ReferenceMap = Record<string, string>

const orderRefKey = (refType: string, refId: string) => `${refType}:${refId}`

export async function fetchOrderReferenceMap(
  client: any,
  companyId: string | null | undefined,
  refs: RefRow[],
) {
  if (!companyId) return {} as ReferenceMap

  const soIds = Array.from(
    new Set(
      refs
        .filter((row) => row.ref_type === 'SO' && row.ref_id)
        .map((row) => row.ref_id as string),
    ),
  )
  const poIds = Array.from(
    new Set(
      refs
        .filter((row) => row.ref_type === 'PO' && row.ref_id)
        .map((row) => row.ref_id as string),
    ),
  )
  const siIds = Array.from(
    new Set(
      refs
        .filter((row) => row.ref_type === 'SI' && row.ref_id)
        .map((row) => row.ref_id as string),
    ),
  )
  const vbIds = Array.from(
    new Set(
      refs
        .filter((row) => row.ref_type === 'VB' && row.ref_id)
        .map((row) => row.ref_id as string),
    ),
  )

  if (!soIds.length && !poIds.length && !siIds.length && !vbIds.length) return {} as ReferenceMap

  const [soRes, poRes, siRes, vbRes] = await Promise.all([
    soIds.length
      ? client.from('sales_orders').select('id,order_no').eq('company_id', companyId).in('id', soIds)
      : Promise.resolve({ data: [], error: null }),
    poIds.length
      ? client.from('purchase_orders').select('id,order_no').eq('company_id', companyId).in('id', poIds)
      : Promise.resolve({ data: [], error: null }),
    siIds.length
      ? client.from('sales_invoices').select('id,internal_reference').eq('company_id', companyId).in('id', siIds)
      : Promise.resolve({ data: [], error: null }),
    vbIds.length
      ? client.from('vendor_bills').select('id,internal_reference,supplier_invoice_reference').eq('company_id', companyId).in('id', vbIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (soRes.error) throw soRes.error
  if (poRes.error) throw poRes.error
  if (siRes.error) throw siRes.error
  if (vbRes.error) throw vbRes.error

  const map: ReferenceMap = {}
  for (const row of (soRes.data || []) as Array<{ id: string; order_no?: string | null }>) {
    map[orderRefKey('SO', row.id)] = row.order_no || row.id
  }
  for (const row of (poRes.data || []) as Array<{ id: string; order_no?: string | null }>) {
    map[orderRefKey('PO', row.id)] = row.order_no || row.id
  }
  for (const row of (siRes.data || []) as Array<{ id: string; internal_reference?: string | null }>) {
    map[orderRefKey('SI', row.id)] = row.internal_reference || row.id
  }
  for (const row of (vbRes.data || []) as Array<{ id: string; internal_reference?: string | null; supplier_invoice_reference?: string | null }>) {
    map[orderRefKey('VB', row.id)] = row.supplier_invoice_reference || row.internal_reference || row.id
  }
  return map
}

export function formatOrderReference(
  refType: string | null | undefined,
  refId: string | null | undefined,
  orderRefByKey: ReferenceMap,
  fallback = '—',
) {
  const type = String(refType || '')
  const id = String(refId || '')
  if (!type) return fallback
  if (!id) return type
  if (type === 'SO' || type === 'PO' || type === 'SI' || type === 'VB') {
    const orderNo = orderRefByKey[orderRefKey(type, id)]
    return orderNo ? `${type} ${orderNo}` : `${type} ${id.slice(0, 8)}`
  }
  return `${type} ${id.slice(0, 8)}`
}

export function buildSettlementMemo(
  kind: 'SO' | 'PO' | 'SI' | 'VB',
  reference: string,
  templates?: { receive?: string; pay?: string },
) {
  const template = kind === 'SO' || kind === 'SI'
    ? templates?.receive || 'Receipt for {orderNo}'
    : templates?.pay || 'Payment for {orderNo}'
  return interpolateMessage(template, { orderNo: reference })
}
