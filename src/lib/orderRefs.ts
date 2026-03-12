import { interpolateMessage } from './i18n'

type RefRow = {
  ref_type?: string | null
  ref_id?: string | null
}

type OrderNumberMap = Record<string, string>

const orderRefKey = (refType: string, refId: string) => `${refType}:${refId}`

export async function fetchOrderReferenceMap(
  client: any,
  companyId: string | null | undefined,
  refs: RefRow[],
) {
  if (!companyId) return {} as OrderNumberMap

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

  if (!soIds.length && !poIds.length) return {} as OrderNumberMap

  const [soRes, poRes] = await Promise.all([
    soIds.length
      ? client.from('sales_orders').select('id,order_no').eq('company_id', companyId).in('id', soIds)
      : Promise.resolve({ data: [], error: null }),
    poIds.length
      ? client.from('purchase_orders').select('id,order_no').eq('company_id', companyId).in('id', poIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (soRes.error) throw soRes.error
  if (poRes.error) throw poRes.error

  const map: OrderNumberMap = {}
  for (const row of (soRes.data || []) as Array<{ id: string; order_no?: string | null }>) {
    map[orderRefKey('SO', row.id)] = row.order_no || row.id
  }
  for (const row of (poRes.data || []) as Array<{ id: string; order_no?: string | null }>) {
    map[orderRefKey('PO', row.id)] = row.order_no || row.id
  }
  return map
}

export function formatOrderReference(
  refType: string | null | undefined,
  refId: string | null | undefined,
  orderRefByKey: OrderNumberMap,
  fallback = '—',
) {
  const type = String(refType || '')
  const id = String(refId || '')
  if (!type) return fallback
  if (!id) return type
  if (type === 'SO' || type === 'PO') {
    const orderNo = orderRefByKey[orderRefKey(type, id)]
    return orderNo ? `${type} ${orderNo}` : `${type} ${id.slice(0, 8)}`
  }
  return `${type} ${id.slice(0, 8)}`
}

export function buildSettlementMemo(
  kind: 'SO' | 'PO',
  orderNo: string,
  templates?: { receive?: string; pay?: string },
) {
  const template = kind === 'SO'
    ? templates?.receive || 'Receipt for {orderNo}'
    : templates?.pay || 'Payment for {orderNo}'
  return interpolateMessage(template, { orderNo })
}
