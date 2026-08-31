import { supabase } from './supabase'
import { maskFinanceAccountNumber } from './financeExport'
import {
  FINANCE_RECONCILIATION_VIEW,
  type FinanceAnchorKind,
  type FinanceLedgerSide,
  type FinanceReconciliationRow,
} from './financeReconciliation'
import type { SettlementKind } from './orderFinance'
import type { PurchaseOrderStateRow, SalesOrderStateRow } from './orderState'

type BankAccountRow = {
  id: string
  name: string
  bank_name: string | null
  account_number: string | null
  currency_code: string | null
}

type CashActivityRow = {
  id: string
  happened_at: string
  type: 'sale_receipt' | 'purchase_payment' | 'adjustment'
  ref_type: SettlementKind | 'ADJ' | null
  ref_id: string | null
  memo: string | null
  amount_base: number
  created_at: string
  user_ref: string | null
}

type BankActivityRow = {
  id: string
  bank_id: string
  happened_at: string
  memo: string | null
  amount_base: number
  reconciled: boolean
  created_at: string
  ref_type: SettlementKind | null
  ref_id: string | null
}

type ActivityAnchor = {
  anchorKind: FinanceAnchorKind
  anchorId: string
  anchorReference: string | null
  operationalReference: string | null
  counterpartyName: string | null
  documentDate: string | null
  dueDate: string | null
  originalLegalBase: number | null
  creditedBase: number | null
  debitedBase: number | null
  currentLegalBase: number | null
  settledBase: number | null
  outstandingBase: number | null
  reviewState: FinanceReconciliationRow['review_state'] | null
}

export type FinanceActivityRow = {
  id: string
  ledgerSide: FinanceLedgerSide
  channel: 'cash' | 'bank'
  happenedAt: string
  createdAt: string
  amountBase: number
  memo: string | null
  refType: SettlementKind
  refId: string
  anchorKind: FinanceAnchorKind | null
  anchorId: string | null
  anchorReference: string | null
  operationalReference: string | null
  counterpartyName: string | null
  documentDate: string | null
  dueDate: string | null
  originalLegalBase: number | null
  creditedBase: number | null
  debitedBase: number | null
  currentLegalBase: number | null
  settledBase: number | null
  outstandingBase: number | null
  reviewState: FinanceReconciliationRow['review_state'] | null
  bankId: string | null
  bankName: string | null
  bankInstitution: string | null
  maskedAccountNumber: string | null
  bankOperatingCurrency: string | null
  reconciled: boolean | null
  unresolvedReference: boolean
}

const isSettlementKind = (value: unknown): value is SettlementKind =>
  value === 'SO' || value === 'PO' || value === 'SI' || value === 'VB'

const ledgerSideFor = (kind: SettlementKind): FinanceLedgerSide =>
  kind === 'SO' || kind === 'SI' ? 'AR' : 'AP'

function rowKey(side: FinanceLedgerSide, refId: string) {
  return `${side}:${refId}`
}

export async function loadFinanceSettlementActivity(
  companyId: string,
  from: string,
  to: string,
): Promise<FinanceActivityRow[]> {
  const [banksResult, cashResult, reconciliationResult, salesOrdersResult, purchaseOrdersResult] = await Promise.all([
    supabase
      .from('bank_accounts')
      .select('id,name,bank_name,account_number,currency_code')
      .eq('company_id', companyId)
      .order('name', { ascending: true }),
    supabase
      .from('cash_transactions')
      .select('id,happened_at,type,ref_type,ref_id,memo,amount_base,created_at,user_ref')
      .eq('company_id', companyId)
      .gte('happened_at', from)
      .lte('happened_at', to)
      .in('ref_type', ['SO', 'PO', 'SI', 'VB'])
      .order('happened_at', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from(FINANCE_RECONCILIATION_VIEW)
      .select('*')
      .eq('company_id', companyId),
    supabase
      .from('v_sales_order_state')
      .select('*')
      .eq('company_id', companyId),
    supabase
      .from('v_purchase_order_state')
      .select('*')
      .eq('company_id', companyId),
  ])

  if (banksResult.error) throw banksResult.error
  if (cashResult.error) throw cashResult.error
  if (reconciliationResult.error) {
    console.warn('Finance activity reference enrichment unavailable:', reconciliationResult.error.message)
  }
  if (salesOrdersResult.error) {
    console.warn('Sales order activity enrichment unavailable:', salesOrdersResult.error.message)
  }
  if (purchaseOrdersResult.error) {
    console.warn('Purchase order activity enrichment unavailable:', purchaseOrdersResult.error.message)
  }

  const banks = (banksResult.data || []) as BankAccountRow[]
  const bankById = new Map(banks.map((bank) => [bank.id, bank]))
  const reconciliationRows = (reconciliationResult.error ? [] : reconciliationResult.data || []) as FinanceReconciliationRow[]
  const anchorById = new Map<string, ActivityAnchor>()
  reconciliationRows.forEach((row) => {
    const anchor: ActivityAnchor = {
      anchorKind: row.anchor_kind,
      anchorId: row.anchor_id,
      anchorReference: row.anchor_reference,
      operationalReference: row.operational_reference,
      counterpartyName: row.counterparty_name,
      documentDate: row.document_date,
      dueDate: row.due_date,
      originalLegalBase: Number(row.original_total_base || 0),
      creditedBase: Number(row.credited_total_base || 0),
      debitedBase: Number(row.debited_total_base || 0),
      currentLegalBase: Number(row.current_legal_total_base || 0),
      settledBase: Number(row.settled_base || 0),
      outstandingBase: Number(row.outstanding_base || 0),
      reviewState: row.review_state,
    }
    anchorById.set(rowKey(row.ledger_side, row.anchor_id), anchor)
    if (row.operational_document_id) {
      anchorById.set(rowKey(row.ledger_side, row.operational_document_id), anchor)
    }
  })

  const addOrderFallback = (
    side: FinanceLedgerSide,
    row: SalesOrderStateRow | PurchaseOrderStateRow,
  ) => {
    const anchorKind: FinanceAnchorKind = row.financial_anchor === 'sales_invoice'
      ? 'sales_invoice'
      : row.financial_anchor === 'vendor_bill'
        ? 'vendor_bill'
        : side === 'AR'
          ? 'sales_order'
          : 'purchase_order'
    const anchorId = row.financial_anchor_document_id || row.id
    const isOrderAnchor = anchorId === row.id
    const settledBase = side === 'AR'
      ? Number((row as SalesOrderStateRow).legacy_settled_base || 0)
      : Number((row as PurchaseOrderStateRow).legacy_paid_base || 0)
    const fallback: ActivityAnchor = {
      anchorKind,
      anchorId,
      anchorReference: row.financial_anchor_reference || row.order_no,
      operationalReference: row.order_no,
      counterpartyName: row.counterparty_name,
      documentDate: row.order_date,
      dueDate: row.due_date,
      originalLegalBase: isOrderAnchor ? Number(row.total_amount_base || 0) : null,
      creditedBase: isOrderAnchor ? 0 : null,
      debitedBase: isOrderAnchor ? 0 : null,
      currentLegalBase: isOrderAnchor ? Number(row.total_amount_base || 0) : null,
      settledBase: isOrderAnchor ? settledBase : null,
      outstandingBase: isOrderAnchor ? Number(row.legacy_outstanding_base || 0) : null,
      reviewState: null,
    }
    const key = rowKey(side, row.id)
    if (!anchorById.has(key)) anchorById.set(key, fallback)
  }

  if (!salesOrdersResult.error) {
    ;((salesOrdersResult.data || []) as SalesOrderStateRow[])
      .forEach((row) => addOrderFallback('AR', row))
  }
  if (!purchaseOrdersResult.error) {
    ;((purchaseOrdersResult.data || []) as PurchaseOrderStateRow[])
      .forEach((row) => addOrderFallback('AP', row))
  }

  const bankResult = banks.length
    ? await supabase
      .from('bank_transactions')
      .select('id,bank_id,happened_at,memo,amount_base,reconciled,created_at,ref_type,ref_id')
      .in('bank_id', banks.map((bank) => bank.id))
      .gte('happened_at', from)
      .lte('happened_at', to)
      .not('ref_type', 'is', null)
      .order('happened_at', { ascending: false })
      .order('created_at', { ascending: false })
    : { data: [] as BankActivityRow[], error: null }

  if (bankResult.error) throw bankResult.error

  const mapActivity = (
    row: CashActivityRow | BankActivityRow,
    channel: 'cash' | 'bank',
  ): FinanceActivityRow | null => {
    if (!isSettlementKind(row.ref_type) || !row.ref_id) return null
    const side = ledgerSideFor(row.ref_type)
    const anchor = anchorById.get(rowKey(side, row.ref_id)) || null
    const bank = channel === 'bank'
      ? bankById.get((row as BankActivityRow).bank_id) || null
      : null
    return {
      id: row.id,
      ledgerSide: side,
      channel,
      happenedAt: row.happened_at,
      createdAt: row.created_at,
      amountBase: Math.abs(Number(row.amount_base || 0)),
      memo: row.memo,
      refType: row.ref_type,
      refId: row.ref_id,
      anchorKind: anchor?.anchorKind || null,
      anchorId: anchor?.anchorId || null,
      anchorReference: anchor?.anchorReference || null,
      operationalReference: anchor?.operationalReference || null,
      counterpartyName: anchor?.counterpartyName || null,
      documentDate: anchor?.documentDate || null,
      dueDate: anchor?.dueDate || null,
      originalLegalBase: anchor?.originalLegalBase ?? null,
      creditedBase: anchor?.creditedBase ?? null,
      debitedBase: anchor?.debitedBase ?? null,
      currentLegalBase: anchor?.currentLegalBase ?? null,
      settledBase: anchor?.settledBase ?? null,
      outstandingBase: anchor?.outstandingBase ?? null,
      reviewState: anchor?.reviewState || null,
      bankId: bank?.id || null,
      bankName: bank?.name || null,
      bankInstitution: bank?.bank_name || null,
      maskedAccountNumber: maskFinanceAccountNumber(bank?.account_number),
      bankOperatingCurrency: bank?.currency_code || null,
      reconciled: channel === 'bank' ? Boolean((row as BankActivityRow).reconciled) : null,
      unresolvedReference: !anchor,
    }
  }

  return [
    ...(cashResult.data || []).map((row) => mapActivity(row as CashActivityRow, 'cash')),
    ...((bankResult.data || []) as BankActivityRow[]).map((row) => mapActivity(row, 'bank')),
  ]
    .filter((row): row is FinanceActivityRow => Boolean(row))
    .sort((left, right) =>
      right.happenedAt.localeCompare(left.happenedAt)
      || right.createdAt.localeCompare(left.createdAt),
    )
}
