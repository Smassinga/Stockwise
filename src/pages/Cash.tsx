import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Download, Settings2, WalletCards } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { useAuth } from '../hooks/useAuth'
import { useI18n, withI18nFallback } from '../lib/i18n'
import type { SettlementKind } from '../lib/orderFinance'
import { fetchOrderReferenceMap, formatOrderReference } from '../lib/orderRefs'
import { financeCan } from '../lib/permissions'
import {
  clearPostingRequestKey,
  getPostingRequestKeyForFingerprint,
  stablePostingFingerprint,
  type PostingRequestKeyRef,
} from '../lib/postingRequestKeys'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import {
  exportFinanceExcel,
  exportFinancePdf,
  printFinanceReport,
  sanitizeFinanceFilename,
  type FinanceExportModel,
} from '../lib/financeExport'
import { loadFinanceExportCompany } from '../lib/financeExportData'
import { FinanceExportDialog, type FinanceExportFormat } from '../components/finance/FinanceExportDialog'
import { FinanceSummaryBand } from '../components/finance/FinanceSummaryBand'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { PremiumStatePanel } from '../components/premium/PremiumEmptyState'

type CashView = 'ledger' | 'adjustment' | 'settings'
type CashSummary = { beginning: number; inflows: number; outflows: number; net: number; ending: number }
type CashTx = {
  id: string
  happened_at: string
  type: 'sale_receipt' | 'purchase_payment' | 'adjustment'
  ref_type: SettlementKind | 'CR' | 'ADJ' | null
  ref_id: string | null
  memo: string | null
  amount_base: number
  running_balance: number
}
type CashBook = {
  id: string
  company_id: string
  beginning_balance_base: number
  beginning_as_of: string
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const monthStartISO = () => {
  const date = new Date()
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10)
}
const validViews = new Set<CashView>(['ledger', 'adjustment', 'settings'])
const normalizeMoneyValue = (value: number) => {
  if (!Number.isFinite(value)) return Number.NaN
  const sign = value < 0 ? -1 : 1
  const normalized = sign * (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100)
  return Object.is(normalized, -0) ? 0 : normalized
}

export default function CashPage() {
  const { t, lang } = useI18n()
  const tf = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const { companyId, companyName, myRole } = useOrg()
  const { user } = useAuth()
  const canManageSettlement = financeCan.settlementSensitive(myRole)
  const [searchParams, setSearchParams] = useSearchParams()
  const rawView = searchParams.get('view') as CashView | null
  const view: CashView = rawView && validViews.has(rawView) ? rawView : 'ledger'

  const [from, setFrom] = useState(monthStartISO())
  const [to, setTo] = useState(todayISO())
  const [typeFilter, setTypeFilter] = useState('all')
  const [summary, setSummary] = useState<CashSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(false)
  const [rows, setRows] = useState<CashTx[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(true)
  const [ledgerError, setLedgerError] = useState(false)
  const [orderRefByKey, setOrderRefByKey] = useState<Record<string, string>>({})
  const [book, setBook] = useState<CashBook | null>(null)
  const [bookLoading, setBookLoading] = useState(true)
  const [bookError, setBookError] = useState(false)
  const [savingBeg, setSavingBeg] = useState(false)
  const [savingTx, setSavingTx] = useState(false)
  const [baseCurrency, setBaseCurrency] = useState('MZN')
  const [adjustment, setAdjustment] = useState({ date: todayISO(), amount: '', memo: '' })
  const [exportOpen, setExportOpen] = useState(false)
  const adjustmentRequestRef = useRef<PostingRequestKeyRef>(null)
  const settlementRequestRef = useRef<PostingRequestKeyRef>(null)

  const setView = (next: CashView) => {
    const params = new URLSearchParams(searchParams)
    params.set('view', next)
    setSearchParams(params)
  }

  useEffect(() => {
    if (!companyId) {
      setBaseCurrency('MZN')
      return
    }
    let mounted = true
    getBaseCurrencyCode(companyId)
      .then((code) => {
        if (mounted && code) setBaseCurrency(code)
      })
      .catch((error) => console.warn('Failed to load Cash base currency:', error))
    return () => {
      mounted = false
    }
  }, [companyId])

  useEffect(() => {
    setBook(null)
    setSummary(null)
    setRows([])
    setOrderRefByKey({})
    setBookError(false)
    setSummaryError(false)
    setLedgerError(false)
    if (!companyId) {
      setBookLoading(false)
      setSummaryLoading(false)
      setLedgerLoading(false)
      return
    }
    void loadBook()
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, from, to, typeFilter])

  async function loadBook() {
    if (!companyId) return
    setBookLoading(true)
    setBookError(false)
    try {
      const rpc = await supabase.rpc('cash_get_book', { p_company: companyId })
      if (!rpc.error) {
        const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data
        setBook(row ? {
          id: row.id,
          company_id: row.company_id,
          beginning_balance_base: Number(row.beginning_balance_base),
          beginning_as_of: String(row.beginning_as_of),
        } : null)
        return
      }
      const fallback = await supabase
        .from('cash_books')
        .select('id, company_id, beginning_balance_base, beginning_as_of')
        .eq('company_id', companyId)
        .maybeSingle()
      if (fallback.error) throw fallback.error
      setBook(fallback.data as CashBook | null)
    } catch (error) {
      console.warn('Cash book settings unavailable:', error)
      setBook(null)
      setBookError(true)
    } finally {
      setBookLoading(false)
    }
  }

  async function loadData() {
    if (!companyId) return
    setSummaryLoading(true)
    setLedgerLoading(true)
    setSummaryError(false)
    setLedgerError(false)

    const summaryResult = await supabase.rpc('cash_summary', { p_company: companyId, p_from: from, p_to: to })
    if (summaryResult.error) {
      console.warn('Cash summary unavailable:', summaryResult.error.message)
      setSummary(null)
      setSummaryError(true)
    } else {
      const row = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data
      if (!row) {
        setSummary(null)
        setSummaryError(true)
      } else {
        setSummary({
          beginning: Number(row.beginning ?? 0),
          inflows: Number(row.inflows ?? 0),
          outflows: Number(row.outflows ?? 0),
          net: Number(row.net ?? 0),
          ending: Number(row.ending ?? 0),
        })
      }
    }
    setSummaryLoading(false)

    const ledgerResult = await supabase.rpc('cash_ledger', { p_company: companyId, p_from: from, p_to: to })
    if (ledgerResult.error) {
      console.warn('Cash ledger unavailable:', ledgerResult.error.message)
      setRows([])
      setOrderRefByKey({})
      setLedgerError(true)
    } else {
      let list = (ledgerResult.data as CashTx[]) || []
      if (typeFilter !== 'all') list = list.filter((row) => row.type === typeFilter)
      setRows(list)
      try {
        setOrderRefByKey(await fetchOrderReferenceMap(supabase, companyId, list))
      } catch (error) {
        console.warn('Cash reference enrichment unavailable:', error)
        setOrderRefByKey({})
      }
    }
    setLedgerLoading(false)
  }

  async function upsertBeginningBalance() {
    if (!companyId || !canManageSettlement) return
    setSavingBeg(true)
    try {
      if (book?.id) {
        const { error } = await supabase
          .from('cash_books')
          .update({
            beginning_balance_base: book.beginning_balance_base,
            beginning_as_of: book.beginning_as_of,
          })
          .eq('id', book.id)
          .eq('company_id', companyId)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from('cash_books')
          .insert({ company_id: companyId, beginning_balance_base: 0, beginning_as_of: todayISO() })
          .select('id, company_id, beginning_balance_base, beginning_as_of')
          .single()
        if (error) throw error
        setBook(data as CashBook)
      }
      toast.success(tf('cash.toast.beginningUpdated', 'Beginning balance updated'))
      await Promise.all([loadBook(), loadData()])
    } catch (error) {
      console.error(error)
      toast.error(tf('cash.toast.beginningSaveFailed', 'Failed to save beginning balance'))
    } finally {
      setSavingBeg(false)
    }
  }

  async function postAdjustment() {
    if (!companyId || !canManageSettlement) return
    const amount = normalizeMoneyValue(Number(adjustment.amount))
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error(tf('cash.toast.amountNonZero', 'Amount must be non-zero'))
      return
    }
    const fingerprint = stablePostingFingerprint({
      amountBase: amount,
      companyId,
      happenedAt: adjustment.date,
      memo: adjustment.memo.trim() || null,
      transactionType: 'cash.adjustment.post',
    })
    const requestKey = getPostingRequestKeyForFingerprint(adjustmentRequestRef, fingerprint)
    setSavingTx(true)
    try {
      const { data, error } = await supabase.rpc('post_cash_adjustment', {
        p_company_id: companyId,
        p_happened_at: adjustment.date,
        p_amount_base: amount,
        p_memo: adjustment.memo.trim() || null,
        p_request_key: requestKey,
      })
      if (error) throw error
      const result = Array.isArray(data) ? data[0] : data
      toast.success(result?.replayed
        ? tf('cash.toast.replayRestored', 'The earlier transaction was already posted. Its original result has been restored.')
        : tf('cash.toast.adjustmentAdded', 'Cash-book adjustment recorded'))
      clearPostingRequestKey(adjustmentRequestRef)
      setAdjustment({ date: todayISO(), amount: '', memo: '' })
      await loadData()
      setView('ledger')
    } catch (error) {
      console.error(error)
      toast.error(cashPostingErrorMessage(error))
    } finally {
      setSavingTx(false)
    }
  }

  const cashPostingErrorMessage = (error: unknown) => {
    const message = String((error as { message?: string } | null)?.message || '').toLowerCase()
    if (message.includes('settlement_anchor_not_ready') || message.includes('settlement_anchor_not_found')) {
      return tf('cash.toast.anchorStale', 'This settlement anchor is no longer ready. Refresh before posting.')
    }
    if (message.includes('settlement_amount_exceeds_outstanding')) {
      return tf('cash.toast.amountTooHigh', 'The settlement amount exceeds the current outstanding balance.')
    }
    if (message.includes('finance_document_became_active_anchor')) {
      return tf('cash.toast.financeAnchorChanged', 'A finance document is now the active settlement anchor. Refresh before posting.')
    }
    if (message.includes('idempotency_key_payload_mismatch')) {
      return tf('cash.toast.payloadMismatch', 'This retry key belongs to different transaction inputs. Review the form and submit again.')
    }
    return tf('cash.toast.addFailed', 'Could not add transaction')
  }

  // Preserved governed compatibility path; the primary selector and posting UI lives in Settlements.
  async function postCashSettlement(
    refType: SettlementKind,
    refId: string,
    happenedAt: string,
    amountBase: number,
    memo: string | null,
  ) {
    if (!companyId || !canManageSettlement) throw new Error('cash_settlement_not_authorized')
    const fingerprint = stablePostingFingerprint({
      amountBase,
      companyId,
      happenedAt,
      memo,
      refId,
      refType,
      transactionType: 'settlement.cash.post',
    })
    const requestKey = getPostingRequestKeyForFingerprint(settlementRequestRef, fingerprint)
    const { data, error } = await supabase.rpc('post_cash_settlement', {
      p_company_id: companyId,
      p_ref_type: refType,
      p_ref_id: refId,
      p_happened_at: happenedAt,
      p_amount_base: amountBase,
      p_memo: memo,
      p_request_key: requestKey,
    })
    if (error) throw new Error(cashPostingErrorMessage(error))
    clearPostingRequestKey(settlementRequestRef)
    return Array.isArray(data) ? data[0] : data
  }

  void postCashSettlement

  const cashTypeLabel = (type: CashTx['type']) => {
    if (type === 'sale_receipt') return tf('cash.saleReceipt', 'Sale receipt')
    if (type === 'purchase_payment') return tf('cash.purchasePayment', 'Purchase payment')
    return tf('cash.adjustment', 'Adjustment')
  }

  const referenceHref = (type: CashTx['ref_type'], id: string | null) => {
    if (!id) return null
    if (type === 'SI') return `/sales-invoices/${id}`
    if (type === 'VB') return `/vendor-bills/${id}`
    if (type === 'SO') return `/orders?tab=sales&orderId=${encodeURIComponent(id)}`
    if (type === 'PO') return `/orders?tab=purchase&orderId=${encodeURIComponent(id)}`
    if (type === 'CR' && companyId) {
      return `/settlements?view=receipts&side=ar&receiptId=${encodeURIComponent(id)}&companyId=${encodeURIComponent(companyId)}`
    }
    return null
  }

  const safeReference = (type: CashTx['ref_type'], id: string | null) => {
    if (!type || !id || !orderRefByKey[`${type}:${id}`]) return tf('financeUx.unresolvedReference', 'Unresolved reference')
    return formatOrderReference(type, id, orderRefByKey, tf('financeUx.unresolvedReference', 'Unresolved reference'))
  }

  const summaryCards = useMemo(() => summary ? [
    { key: 'beginning', label: tf('cash.beginning', 'Beginning balance'), value: summary.beginning },
    { key: 'inflows', label: tf('cash.inflows', 'Inflows'), value: summary.inflows },
    { key: 'outflows', label: tf('cash.outflows', 'Outflows'), value: summary.outflows },
    { key: 'net', label: tf('cash.net', 'Net movement'), value: summary.net },
    { key: 'ending', label: tf('cash.ending', 'Ending balance'), value: summary.ending },
  ] : [], [summary, tf])

  const buildCashExport = async (): Promise<FinanceExportModel> => {
    if (!companyId || ledgerError || summaryError || !summary) throw new Error('cash_export_evidence_unavailable')
    const company = await loadFinanceExportCompany(companyId)
    return {
      context: {
        title: tf('financeUx.cashBookReport', 'Cash Book Report'),
        subtitle: tf('financeUx.currentFilteredView', 'Current filtered view'),
        language: lang === 'pt' ? 'pt' : 'en',
        generatedAt: new Date().toISOString(),
        generatedBy: user?.email || null,
        company,
        period: { from, to },
        filters: [typeFilter === 'all' ? tf('cash.allTypes', 'All movement types') : cashTypeLabel(typeFilter as CashTx['type'])],
        baseCurrency,
        disclaimer: tf('financeUx.cashDisclaimer', 'This report reflects the StockWise company cash book in company base currency.'),
      },
      summary: [
        { label: tf('cash.beginning', 'Beginning balance'), value: summary.beginning, type: 'currency' },
        { label: tf('cash.inflows', 'Inflows'), value: summary.inflows, type: 'currency' },
        { label: tf('cash.outflows', 'Outflows'), value: summary.outflows, type: 'currency' },
        { label: tf('cash.net', 'Net movement'), value: summary.net, type: 'currency' },
        { label: tf('cash.ending', 'Ending balance'), value: summary.ending, type: 'currency' },
      ],
      sections: [{
        title: tf('cash.ledger', 'Cash ledger'),
        columns: [
          { key: 'date', label: tf('table.date', 'Date'), width: 14 },
          { key: 'type', label: tf('filters.type', 'Type'), width: 22 },
          { key: 'reference', label: tf('table.ref', 'Reference'), width: 22 },
          { key: 'memo', label: tf('bank.memo', 'Memo'), width: 34 },
          { key: 'inflow', label: tf('cash.inflows', 'Inflow'), width: 16, type: 'currency' },
          { key: 'outflow', label: tf('cash.outflows', 'Outflow'), width: 16, type: 'currency' },
          { key: 'running', label: tf('cash.running', 'Running balance'), width: 18, type: 'currency' },
        ],
        rows: rows.map((row) => ({
          date: row.happened_at,
          type: cashTypeLabel(row.type),
          reference: safeReference(row.ref_type, row.ref_id),
          memo: row.memo || '',
          inflow: row.amount_base > 0 ? row.amount_base : null,
          outflow: row.amount_base < 0 ? Math.abs(row.amount_base) : null,
          running: row.running_balance,
        })),
      }],
      filename: sanitizeFinanceFilename(`StockWise_Cash_Book_${from}_${to}`),
      orientation: 'landscape',
    }
  }

  const generateExport = async (format: FinanceExportFormat) => {
    const model = await buildCashExport()
    if (format === 'excel') await exportFinanceExcel(model)
    else if (format === 'pdf') await exportFinancePdf(model)
    else await printFinanceReport(model)
  }

  const exportLabels = {
    report: tf('financeUx.report', 'Report'),
    scope: tf('financeUx.scope', 'Scope'),
    period: tf('financeUx.period', 'Period'),
    recordCount: tf('financeUx.recordCount', 'Record count'),
    currencyBasis: tf('financeUx.currencyBasis', 'Currency basis'),
    language: tf('financeUx.language', 'Language'),
    english: tf('financeUx.english', 'English'),
    portuguese: tf('financeUx.portuguese', 'Portuguese'),
    bilingual: tf('financeUx.bilingual', 'Bilingual'),
    downloadExcel: tf('financeUx.downloadExcel', 'Download Excel'),
    downloadPdf: tf('financeUx.downloadPdf', 'Download PDF'),
    print: tf('financeUx.print', 'Print'),
    cancel: tf('actions.cancel', 'Cancel'),
    preparing: tf('financeUx.preparing', 'Preparing output...'),
    failed: tf('financeUx.exportFailed', 'The report could not be prepared. No partial output was downloaded.'),
  }

  return (
    <div className="app-page app-page--workspace space-y-6">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{tf('cash.title', 'Cash Book')}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {tf('financeUx.cashSubtitle', 'Review company-base-currency cash evidence, record controlled adjustments, and route customer or supplier settlements through the active finance anchor.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{companyName || tf('company.selectCompany', 'Select company')}</span>
          <Button asChild variant="outline"><Link to="/settlements">{tf('nav.settlements', 'Settlements')}</Link></Button>
          <Button variant="outline" disabled={ledgerError || summaryError} onClick={() => setExportOpen(true)}>
            <Download className="mr-2 h-4 w-4" />{tf('financeUx.exportCashBook', 'Export current Cash Book')}
          </Button>
        </div>
      </header>

      <nav aria-label={tf('financeUx.cashViews', 'Cash Book views')} className="flex flex-wrap gap-2">
        {([
          ['ledger', WalletCards, tf('financeUx.ledger', 'Ledger')],
          ['adjustment', ArrowUpRight, tf('financeUx.adjustment', 'Adjustment')],
          ['settings', Settings2, tf('settings.title', 'Settings')],
        ] as const).map(([key, Icon, label]) => (
          <Button key={key} variant={view === key ? 'default' : 'outline'} onClick={() => setView(key)} aria-current={view === key ? 'page' : undefined}>
            <Icon className="mr-2 h-4 w-4" />{label}
          </Button>
        ))}
      </nav>

      {view === 'ledger' ? (
        <>
          <Card>
            <CardHeader><CardTitle>{tf('cash.filtersTitle', 'Ledger filters')}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2"><Label>{tf('filters.from', 'From')}</Label><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
              <div className="space-y-2"><Label>{tf('filters.to', 'To')}</Label><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
              <div className="space-y-2">
                <Label>{tf('filters.type', 'Type')}</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tf('cash.allTypes', 'All movement types')}</SelectItem>
                    <SelectItem value="sale_receipt">{tf('cash.saleReceipt', 'Sale receipt')}</SelectItem>
                    <SelectItem value="purchase_payment">{tf('cash.purchasePayment', 'Purchase payment')}</SelectItem>
                    <SelectItem value="adjustment">{tf('cash.adjustment', 'Adjustment')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {summaryLoading ? <PremiumStatePanel variant="loading" title={tf('financeUx.loadingSummary', 'Loading cash summary')} /> : null}
          {summaryError ? (
            <PremiumStatePanel
              variant="error"
              title={tf('financeUx.cashSummaryUnavailable', 'Cash summary unavailable')}
              description={tf('financeUx.cashSummaryUnavailableHelp', 'The Cash ledger may still be available. No zero balance has been inferred.')}
            />
          ) : null}
          {!summaryLoading && !summaryError ? (
            <FinanceSummaryBand
              label={tf('financeUx.cashPosition', 'Cash position')}
              items={summaryCards.map((item) => ({
                label: item.label,
                value: formatMoneyBase(item.value, baseCurrency),
                tone: item.key === 'ending' ? 'info' : 'neutral',
              }))}
            />
          ) : null}

          {ledgerLoading ? <PremiumStatePanel variant="loading" title={tf('financeUx.loadingLedger', 'Loading Cash ledger')} /> : null}
          {ledgerError ? (
            <PremiumStatePanel
              variant="error"
              title={tf('financeUx.cashLedgerUnavailable', 'Cash ledger unavailable')}
              description={tf('financeUx.cashLedgerUnavailableHelp', 'Existing summary evidence is retained. An empty ledger has not been inferred.')}
            />
          ) : null}
          {!ledgerLoading && !ledgerError ? (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>{tf('cash.ledger', 'Cash ledger')}</CardTitle>
                <CardDescription>{tf('financeUx.cashLedgerHelp', 'Inflows and outflows are shown separately in company base currency.')}</CardDescription>
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? (
                  <PremiumStatePanel variant="empty" title={tf('cash.emptyLedger', 'No cash-book transactions match the current filters.')} />
                ) : (
                  <>
                    <div className="grid gap-3 md:hidden">
                      {rows.map((row) => {
                        const href = referenceHref(row.ref_type, row.ref_id)
                        return (
                          <article key={row.id} className="rounded-lg border border-border/70 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div><p className="font-medium">{cashTypeLabel(row.type)}</p><p className="text-sm text-muted-foreground">{row.happened_at}</p></div>
                              <span className={row.amount_base >= 0 ? 'text-positive' : 'text-negative'}>
                                {row.amount_base >= 0 ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                              </span>
                            </div>
                            <p className="mt-3 text-xl font-semibold">{formatMoneyBase(row.amount_base, baseCurrency)}</p>
                            <p className="mt-2 text-sm text-muted-foreground">{row.memo || tf('common.dash', '-')}</p>
                            {href ? <Link className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline" to={href}>{safeReference(row.ref_type, row.ref_id)}</Link> : null}
                          </article>
                        )
                      })}
                    </div>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b text-left"><th className="py-3 pr-3">{tf('table.date', 'Date')}</th><th className="py-3 pr-3">{tf('filters.type', 'Type')}</th><th className="py-3 pr-3">{tf('table.ref', 'Reference')}</th><th className="py-3 pr-3">{tf('bank.memo', 'Memo')}</th><th className="py-3 pr-3 text-right">{tf('cash.inflows', 'Inflow')}</th><th className="py-3 pr-3 text-right">{tf('cash.outflows', 'Outflow')}</th><th className="py-3 text-right">{tf('cash.running', 'Running balance')}</th></tr></thead>
                        <tbody>{rows.map((row) => {
                          const href = referenceHref(row.ref_type, row.ref_id)
                          const reference = safeReference(row.ref_type, row.ref_id)
                          return <tr key={row.id} className="border-b border-border/60"><td className="py-3 pr-3">{row.happened_at}</td><td className="py-3 pr-3">{cashTypeLabel(row.type)}</td><td className="py-3 pr-3">{href ? <Link className="text-primary hover:underline" to={href}>{reference}</Link> : reference}</td><td className="py-3 pr-3 text-muted-foreground">{row.memo || tf('common.dash', '-')}</td><td className="py-3 pr-3 text-right">{row.amount_base > 0 ? formatMoneyBase(row.amount_base, baseCurrency) : tf('common.dash', '-')}</td><td className="py-3 pr-3 text-right">{row.amount_base < 0 ? formatMoneyBase(Math.abs(row.amount_base), baseCurrency) : tf('common.dash', '-')}</td><td className="py-3 text-right font-medium">{formatMoneyBase(row.running_balance, baseCurrency)}</td></tr>
                        })}</tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {view === 'adjustment' ? (
        <Card>
          <CardHeader>
            <CardTitle>{tf('financeUx.cashAdjustment', 'Cash-book adjustment')}</CardTitle>
            <CardDescription>{tf('financeUx.cashAdjustmentHelp', 'Adjustments are signed Cash Book entries. They are not customer receipts or supplier payments; use Settlements for those.')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2"><Label>{tf('table.date', 'Date')}</Label><Input type="date" value={adjustment.date} onChange={(event) => setAdjustment((current) => ({ ...current, date: event.target.value }))} /></div>
            <div className="space-y-2"><Label>{tf('cash.amount', 'Amount ({code})', { code: baseCurrency })}</Label><Input inputMode="decimal" value={adjustment.amount} onChange={(event) => setAdjustment((current) => ({ ...current, amount: event.target.value }))} /></div>
            <div className="space-y-2"><Label>{tf('cash.memo', 'Memo')}</Label><Input value={adjustment.memo} onChange={(event) => setAdjustment((current) => ({ ...current, memo: event.target.value }))} /></div>
            <div className="sm:col-span-3 flex flex-wrap items-center justify-between gap-3">
              {!canManageSettlement ? <p className="text-sm text-muted-foreground">{tf('cash.financeAuthorityNotice', 'Only finance-authority users can post cash adjustments.')}</p> : <span />}
              <Button disabled={!canManageSettlement || savingTx} onClick={postAdjustment}>{savingTx ? tf('actions.saving', 'Saving...') : tf('financeUx.recordAdjustment', 'Record adjustment')}</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {view === 'settings' ? (
        bookLoading ? <PremiumStatePanel variant="loading" title={tf('financeUx.loadingCashSettings', 'Loading Cash Book settings')} /> :
          bookError ? <PremiumStatePanel variant="error" title={tf('financeUx.cashSettingsUnavailable', 'Cash Book settings unavailable')} description={tf('financeUx.cashSettingsUnavailableHelp', 'No beginning balance has been inferred.')} /> :
            <Card>
              <CardHeader><CardTitle>{tf('cash.beginningBalance', 'Beginning balance')}</CardTitle><CardDescription>{tf('cash.beginningHelp', 'Set the starting position for this company cash book in company base currency.')}</CardDescription></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div className="space-y-2"><Label>{tf('cash.asOf', 'As of')}</Label><Input type="date" value={book?.beginning_as_of ?? todayISO()} onChange={(event) => setBook((current) => current ? { ...current, beginning_as_of: event.target.value } : { id: '', company_id: companyId || '', beginning_balance_base: 0, beginning_as_of: event.target.value })} /></div>
                <div className="space-y-2"><Label>{tf('cash.amount', 'Amount ({code})', { code: baseCurrency })}</Label><Input inputMode="decimal" value={String(book?.beginning_balance_base ?? 0)} onChange={(event) => setBook((current) => current ? { ...current, beginning_balance_base: Number(event.target.value) } : { id: '', company_id: companyId || '', beginning_balance_base: Number(event.target.value), beginning_as_of: todayISO() })} /></div>
                <Button disabled={!canManageSettlement || savingBeg} onClick={upsertBeginningBalance}>{savingBeg ? tf('actions.saving', 'Saving...') : tf('actions.save', 'Save')}</Button>
              </CardContent>
            </Card>
      ) : null}

      {(summaryError || ledgerError || bookError) ? (
        <div className="flex items-center gap-2 text-sm text-status-warning-foreground"><AlertTriangle className="h-4 w-4" />{tf('financeUx.partialEvidence', 'Some finance evidence is unavailable. Available sections remain visible and no missing value is treated as zero.')}</div>
      ) : null}

      <FinanceExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title={tf('financeUx.cashBookReport', 'Cash Book Report')}
        description={tf('financeUx.exportConfirmation', 'Confirm the evidence scope before generating the file.')}
        scope={tf('financeUx.currentFilteredView', 'Current filtered view')}
        period={`${from} - ${to}`}
        recordCount={rows.length}
        currencyBasis={`${tf('financeUx.companyBaseCurrency', 'Company base currency')}: ${baseCurrency}`}
        language={lang === 'pt' ? 'pt' : 'en'}
        labels={exportLabels}
        onGenerate={generateExport}
      />
    </div>
  )
}
