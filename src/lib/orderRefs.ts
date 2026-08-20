import { interpolateMessage } from './i18n'
export {
  fetchFinanceReferenceMap as fetchOrderReferenceMap,
  formatFinanceReference as formatOrderReference,
} from './financeReferenceResolver'

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
