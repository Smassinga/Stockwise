// src/pages/BankDetail.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/db'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import toast from 'react-hot-toast'
import {
  getBankTransactionWriteMessage,
  getBankTransactionRefSupport,
  isMissingBankTransactionRefColumns,
  setBankTransactionRefSupport,
} from '../lib/bankTransactionRefs'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { useOrg } from '../hooks/useOrg'
import { hasRole, CanManageUsers } from '../lib/roles'
import { useI18n, withI18nFallback } from '../lib/i18n'
import type { SettlementKind } from '../lib/orderFinance'
import { fetchOrderReferenceMap, formatOrderReference } from '../lib/orderRefs'
import { financeCan } from '../lib/permissions'
import { useAuth } from '../hooks/useAuth'
import {
  exportFinanceExcel,
  exportFinancePdf,
  maskFinanceAccountNumber,
  printFinanceReport,
  sanitizeFinanceFilename,
  type FinanceExportModel,
} from '../lib/financeExport'
import { loadFinanceExportCompany } from '../lib/financeExportData'
import { FinanceExportDialog, type FinanceExportFormat } from '../components/finance/FinanceExportDialog'
import { PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import { Badge } from '../components/ui/badge'
import {
  clearPostingRequestKey,
  getPostingRequestKeyForFingerprint,
  stablePostingFingerprint,
  type PostingRequestKeyRef,
} from '../lib/postingRequestKeys'

type Bank = {
  id: string
  company_id: string
  name: string
  bank_name: string | null
  account_number: string | null
  currency_code: string | null
  tax_number?: string | null
  swift?: string | null
  nib?: string | null
}

type Tx = {
  id: string
  bank_id: string
  happened_at: string
  memo: string | null
  amount_base: number
  reconciled: boolean
  created_at: string
  ref_type?: SettlementKind | null
  ref_id?: string | null
}

type Statement = {
  id: string
  bank_id: string
  statement_date: string
  closing_balance_base: number
  file_path: string | null
  reconciled: boolean
  created_at: string
}

type BankImportRow = {
  row_number: number
  happened_at: string
  memo: string | null
  amount_base: string
  currency_code: string | null
  direction: 'ledger'
  ref_type: null
  ref_id: null
}

type BankView = 'ledger' | 'reconciliation' | 'statements' | 'import' | 'settings'
const validBankViews = new Set<BankView>(['ledger', 'reconciliation', 'statements', 'import', 'settings'])

const todayISO = () => new Date().toISOString().slice(0, 10)
const monthStartISO = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

// ---------- CSV helpers (DD/MM/YYYY-first) ----------
function detectDelimiter(header: string) {
  const counts: Array<[string, number]> = [
    [',', (header.match(/,/g) || []).length],
    [';', (header.match(/;/g) || []).length],
    ['\t', (header.match(/\t/g) || []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}
function splitCSVLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else { inQ = !inQ }
    } else if (ch === delim && !inQ) {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map(s => s.trim())
}
function normalizeDateDDMMYYYY(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t

  let m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (m) {
    let dd = parseInt(m[1], 10)
    let mm = parseInt(m[2], 10)
    let yy = parseInt(m[3].length === 2 ? (Number(m[3]) + 2000).toString() : m[3], 10)
    if (dd <= 12 && mm > 12) { const tmp = dd; dd = mm; mm = tmp }
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
    return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  }
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (m) {
    const dd = String(parseInt(m[1], 10)).padStart(2, '0')
    const mm = String(parseInt(m[2], 10)).padStart(2, '0')
    const yy = m[3]
    return `${yy}-${mm}-${dd}`
  }
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const mm = parseInt(m[1], 10)
    const dd = parseInt(m[2], 10)
    const yy = m[3]
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }
  return null
}
function parseAmount(raw: string): number | null {
  if (!raw) return null
  let s = raw.replace(/[^\d,\.\-\s]/g, '').replace(/\s+/g, '')
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (lastComma !== -1) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function normalizeMoneyValue(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN
  const sign = value < 0 ? -1 : 1
  const normalized = sign * (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100)
  return Object.is(normalized, -0) ? 0 : normalized
}

function normalizedMoneyToken(value: number): string | null {
  const normalized = normalizeMoneyValue(value)
  return Number.isFinite(normalized) && normalized !== 0 ? normalized.toFixed(2) : null
}

async function sha256Hex(value: string) {
  if (!globalThis.crypto?.subtle) throw new Error('bank_import_digest_unavailable')
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function durableBankImportRequestKey(
  companyId: string,
  bankId: string,
  rows: BankImportRow[],
) {
  const canonicalRows = rows
    .map(({ row_number: _rowNumber, ...row }) => row)
    .sort((left, right) => stablePostingFingerprint(left).localeCompare(stablePostingFingerprint(right)))
  const canonicalPayload = stablePostingFingerprint({ bankId, companyId, rows: canonicalRows })
  return `bank-import:${await sha256Hex(canonicalPayload)}`
}

function bankImportErrorDetail(error: any) {
  const inlineRow = Number(error?.rowNumber)
  const inlineCode = String(error?.code || error?.message || '')
  try {
    const parsed = JSON.parse(String(error?.details || ''))
    return {
      code: String(parsed?.code || inlineCode),
      rowNumber: Number(parsed?.row_number || inlineRow) || null,
    }
  } catch {
    return { code: inlineCode, rowNumber: inlineRow || null }
  }
}
// ---------------------------------------------------

export default function BankDetail() {
  const { t, lang } = useI18n()
  const { bankId: bankIdA, id: bankIdB } = useParams()
  const bankId = bankIdA ?? bankIdB
  const { myRole, companyId, companyName } = useOrg()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawView = searchParams.get('view') as BankView | null
  const view: BankView = rawView && validBankViews.has(rawView) ? rawView : 'ledger'
  const tf = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const canEditBank = hasRole(myRole, CanManageUsers)
  const canManageSettlement = financeCan.settlementSensitive(myRole)

  const [bank, setBank] = useState<Bank | null>(null)
  const [bankLoading, setBankLoading] = useState(true)
  const [bankError, setBankError] = useState(false)
  const [from, setFrom] = useState<string>(monthStartISO())
  const [to, setTo] = useState<string>(todayISO())
  const [rows, setRows] = useState<Tx[]>([])
  const [transactionsLoading, setTransactionsLoading] = useState(true)
  const [transactionsError, setTransactionsError] = useState(false)
  const [orderRefByKey, setOrderRefByKey] = useState<Record<string, string>>({})
  const [onlyUnreconciled, setOnlyUnreconciled] = useState<boolean>(false)
  const [statements, setStatements] = useState<Statement[]>([])
  const [statementsLoading, setStatementsLoading] = useState(true)
  const [statementsError, setStatementsError] = useState(false)
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null)
  const [bookBalance, setBookBalance] = useState<number | null>(null)
  const [bookBalanceLoading, setBookBalanceLoading] = useState(true)
  const [bookBalanceError, setBookBalanceError] = useState(false)
  const [savingTx, setSavingTx] = useState<string | null>(null)
  const bankManualPostingRequestRef = useRef<PostingRequestKeyRef>(null)

  const [baseCurrency, setBaseCurrency] = useState<string>('MZN')

  const scopedBankId = bank && bank.company_id === companyId ? bank.id : null

  // Statement form
  const [stDate, setStDate] = useState<string>(todayISO())
  const [stClosing, setStClosing] = useState<string>('0')
  const [stFile, setStFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  // CSV import
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvPreviewRows, setCsvPreviewRows] = useState<BankImportRow[]>([])
  const [csvPreviewError, setCsvPreviewError] = useState<string | null>(null)
  const [previewingCsv, setPreviewingCsv] = useState(false)
  const [importing, setImporting] = useState(false)

  // Manual transaction form
  const [txDate, setTxDate] = useState<string>(todayISO())
  const [txMemo, setTxMemo] = useState<string>('')
  const [txAmt, setTxAmt] = useState<string>('0')
  const [addingTx, setAddingTx] = useState(false)
  const [exportKind, setExportKind] = useState<'ledger' | 'reconciliation' | null>(null)

  // Separate “latest request” guards
  const latestTxReq = useRef(0)
  const latestStmtReq = useRef(0)
  const latestBalReq = useRef(0)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const code = await getBaseCurrencyCode(companyId)
        if (mounted && code) setBaseCurrency(code)
      } catch {}
    })()
    return () => { mounted = false }
  }, [companyId])

  const currency = (bank?.currency_code ?? baseCurrency) || 'MZN'
  const selectedStatement = statements.find((statement) => statement.id === selectedStatementId) || null

  const diff = useMemo(() => {
    if (bookBalance === null || !selectedStatement) return null
    return bookBalance - selectedStatement.closing_balance_base
  }, [bookBalance, selectedStatement])

  const setView = (next: BankView) => {
    const params = new URLSearchParams(searchParams)
    params.set('view', next)
    setSearchParams(params)
  }

  useEffect(() => {
    if (!bankId || !companyId) {
      setBank(null)
      setBankLoading(false)
      return
    }
    setBank(null)
    setSelectedStatementId(null)
    void loadBank()
  }, [bankId, companyId])

  useEffect(() => {
    if (!scopedBankId) {
      setRows([])
      setStatements([])
      setBookBalance(null)
      setOrderRefByKey({})
      setTransactionsLoading(false)
      setStatementsLoading(false)
      setBookBalanceLoading(false)
      return
    }
    void loadTx()
    void loadStatements()
    void loadBookBalance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedBankId, from, to, onlyUnreconciled])

  async function loadBank() {
    if (!bankId || !companyId) return
    setBankLoading(true)
    setBankError(false)
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('id, company_id, name, bank_name, account_number, currency_code, tax_number, swift, nib')
      .eq('id', bankId)
      .eq('company_id', companyId)
      .maybeSingle()
    if (error) {
      console.warn('bank_accounts not ready:', error.message)
      setBank(null)
      setBankError(true)
      setBankLoading(false)
      return
    }
    setBank(data as Bank)
    setBankLoading(false)
  }

  async function saveBankDetails() {
    if (!bank || bank.company_id !== companyId || !canEditBank) return
    try {
      const payload: Partial<Bank> = {
        name: (bank.name ?? '').trim() || bank.name, // allow clearing if desired
        bank_name: bank.bank_name ?? null,
        account_number: bank.account_number ?? null,
        currency_code: bank.currency_code ?? null,
        tax_number: bank.tax_number ?? null,
        swift: bank.swift ?? null,
        nib: bank.nib ?? null,
      }
      const { error } = await supabase.from('bank_accounts').update(payload).eq('id', bank.id).eq('company_id', bank.company_id)
      if (error) throw error
      toast.success(tf('bank.toast.saved', 'Bank details saved'))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tf('bank.toast.saveFailed', 'Failed to save bank details'))
    }
  }

  async function loadTx() {
    if (!scopedBankId) return
    setTransactionsLoading(true)
    setTransactionsError(false)
    const myReq = ++latestTxReq.current
    let data: any[] | null = null
    let error: any = null

    const withRefs = await supabase
      .from('bank_transactions')
      .select('id, bank_id, happened_at, memo, amount_base, reconciled, created_at, ref_type, ref_id')
      .eq('bank_id', scopedBankId)
      .gte('happened_at', from)
      .lte('happened_at', to)
      .order('happened_at', { ascending: true })
      .order('created_at', { ascending: true })

    data = withRefs.data || null
    error = withRefs.error

    if (!error) {
      setBankTransactionRefSupport(true)
    } else if (isMissingBankTransactionRefColumns(error)) {
      setBankTransactionRefSupport(false)
    }

    if (getBankTransactionRefSupport() === false) {
      const fallback = await supabase
        .from('bank_transactions')
        .select('id, bank_id, happened_at, memo, amount_base, reconciled, created_at')
        .eq('bank_id', scopedBankId)
        .gte('happened_at', from)
        .lte('happened_at', to)
        .order('happened_at', { ascending: true })
        .order('created_at', { ascending: true })
      data = (fallback.data || []).map((row: any) => ({ ...row, ref_type: null, ref_id: null }))
      error = fallback.error
    }
    if (myReq !== latestTxReq.current) return
    if (error) {
      console.warn('bank_transactions not ready:', error.message)
      setRows([])
      setOrderRefByKey({})
      setTransactionsError(true)
      setTransactionsLoading(false)
      return
    }
    let list = (data as Tx[]) || []
    if (onlyUnreconciled) list = list.filter(r => !r.reconciled)
    setRows(list)
    try {
      const activeCompanyId = bank?.company_id || companyId
      setOrderRefByKey(await fetchOrderReferenceMap(supabase, activeCompanyId, list))
    } catch (lookupError) {
      console.warn('Failed to resolve bank transaction order references:', lookupError)
      setOrderRefByKey({})
    }
    setTransactionsLoading(false)
  }

  async function loadStatements() {
    if (!scopedBankId) return
    setStatementsLoading(true)
    setStatementsError(false)
    const myReq = ++latestStmtReq.current
    const { data, error } = await supabase
      .from('bank_statements')
      .select('id, bank_id, statement_date, closing_balance_base, file_path, reconciled, created_at')
      .eq('bank_id', scopedBankId)
      .order('statement_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (myReq !== latestStmtReq.current) return
    if (error) {
      console.warn('bank_statements not ready:', error.message)
      setStatements([])
      setStatementsError(true)
      setStatementsLoading(false)
      return
    }
    setStatements(data as Statement[])
    setStatementsLoading(false)
  }

  async function loadBookBalance() {
    if (!scopedBankId) return
    setBookBalanceLoading(true)
    setBookBalanceError(false)
    const myReq = ++latestBalReq.current
    const { data, error } = await supabase.rpc('bank_book_balance', { p_bank: scopedBankId })
    if (myReq !== latestBalReq.current) return
    if (error) {
      console.warn('bank_book_balance not ready:', error.message)
      setBookBalance(null)
      setBookBalanceError(true)
      setBookBalanceLoading(false)
      return
    }
    const balanceValue = typeof data === 'number'
      ? data
      : (data as { balance?: number | null } | null)?.balance
    const normalizedBalance = balanceValue === null || balanceValue === undefined
      ? Number.NaN
      : Number(balanceValue)
    if (!Number.isFinite(normalizedBalance)) {
      setBookBalance(null)
      setBookBalanceError(true)
      setBookBalanceLoading(false)
      return
    }
    setBookBalance(normalizedBalance)
    setBookBalanceLoading(false)
  }

  async function toggleReconciled(txId: string, value: boolean) {
    if (!scopedBankId || !canManageSettlement) return
    setSavingTx(txId)
    try {
      const { error } = await supabase
        .from('bank_transactions')
        .update({ reconciled: value })
        .eq('id', txId)
        .eq('bank_id', scopedBankId)
      if (error) throw error
      setRows(rs => rs.map(r => (r.id === txId ? { ...r, reconciled: value } : r)))
    } catch (e: any) {
      toast.error(t('bank.toast.updateReconFailed'))
      console.error(e)
    } finally {
      setSavingTx(null)
    }
  }

  // ----- Statements: upload, open (download), delete -----

  async function uploadStatement() {
    if (!scopedBankId || !canManageSettlement) return
    if (!stDate) { toast.error(t('bank.statementDate')); return }
    const closing = Number(stClosing)
    if (Number.isNaN(closing)) { toast.error(t('common.headsUp')); return }

    setUploading(true)
    try {
      let file_path: string | null = null
      if (stFile) {
        const sanitized = stFile.name.replace(/[^A-Za-z0-9._-]/g, '_')
        const fileName = `${bankId}/${stDate}-${Date.now()}-${sanitized}`
        const { error: upErr } = await supabase
          .storage
          .from('bank-statements')
          .upload(fileName, stFile, { cacheControl: '3600', upsert: false })
        if (upErr) throw upErr
        file_path = fileName
      }

      const { data: inserted, error } = await supabase
        .from('bank_statements')
        .insert({
          bank_id: scopedBankId,
          statement_date: stDate,
          closing_balance_base: closing,
          file_path,
          reconciled: false,
        })
        .select('id, bank_id, statement_date, closing_balance_base, file_path, reconciled, created_at')
        .single()

      if (error) throw error

      setStatements(prev => [inserted as Statement, ...prev])
      setStDate(todayISO()); setStClosing('0'); setStFile(null)
      await loadBookBalance()
      await loadStatements()
      toast.success(tf('bank.toast.statementSaved', 'Statement saved'))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tf('bank.toast.statementSaveFailed', 'Could not save statement'))
    } finally {
      setUploading(false)
    }
  }

  async function openFile(key: string) {
    if (!scopedBankId) return
    try {
      const { data, error } = await supabase.storage.from('bank-statements').download(key)
      if (error) {
        const { data: s, error: sErr } = await supabase.storage.from('bank-statements').createSignedUrl(key, 60)
        if (sErr || !s?.signedUrl) throw sErr || new Error('Cannot create signed URL')
        window.open(s.signedUrl, '_blank', 'noopener,noreferrer')
        return
      }
      const blob = data
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) {
      console.error(e)
      toast.error(t('bank.toast.toggleFailed'))
    }
  }

  async function deleteStatement(s: Statement) {
    if (!scopedBankId || s.bank_id !== scopedBankId || !canManageSettlement) return
    if (s.reconciled) {
      toast.error(tf('bank.toast.statementLocked', 'Reconciled statements cannot be deleted'))
      return
    }
    setStatements(prev => prev.filter(x => x.id !== s.id))
    if (selectedStatementId === s.id) setSelectedStatementId(null)
    try {
      if (s.file_path) {
        const { error: remErr } = await supabase.storage.from('bank-statements').remove([s.file_path])
        if (remErr && !/not\s*found/i.test(remErr.message || '')) {
          console.warn('Storage remove error:', remErr.message)
        }
      }
      const { error } = await supabase.from('bank_statements').delete().eq('id', s.id).eq('bank_id', scopedBankId)
      if (error) throw error
      await loadBookBalance()
      await loadStatements()
      toast.success(t('bank.toast.deleted'))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || t('bank.toast.deleteFailed'))
      await loadStatements()
    }
  }

  async function toggleStatementReconciled(statement: Statement) {
    if (!scopedBankId || !canManageSettlement) return
    const { error } = await supabase
      .from('bank_statements')
      .update({ reconciled: !statement.reconciled })
      .eq('id', statement.id)
      .eq('bank_id', scopedBankId)
    if (error) {
      toast.error(t('bank.toast.toggleFailed'))
      return
    }
    setStatements((current) => current.map((row) => (
      row.id === statement.id ? { ...row, reconciled: !row.reconciled } : row
    )))
    await loadBookBalance()
  }

  function showBankPostingError(error: any, context: 'import' | 'manual') {
    const message = String(error?.message || '').toLowerCase()
    const detail = bankImportErrorDetail(error)
    const code = `${message} ${detail.code}`.toLowerCase()
    let localized: string | null = null

    if (code.includes('request_key_required') || code.includes('bank_import_digest_unavailable')) {
      localized = tf('bank.toast.requestKeyRequired', 'Refresh and try again with a valid posting key.')
    } else if (code.includes('idempotency_key_payload_mismatch')) {
      localized = tf('bank.toast.payloadMismatch', 'This retry key belongs to different transaction inputs. Review the form and submit again.')
    } else if (code.includes('request_in_progress')) {
      localized = tf('bank.toast.requestInProgress', 'This transaction is already being posted. Wait a moment and refresh.')
    } else if (code.includes('bank_import_empty') || code.includes('bank_import_rows_required')) {
      localized = tf('bank.toast.csvNoRows', 'No valid rows to import')
    } else if (code.includes('bank_import_row_limit_exceeded')) {
      localized = tf('bank.toast.csvTooManyRows', 'This import exceeds the 500-row limit. Split it into smaller files.')
    } else if (code.includes('bank_import_request_too_large')) {
      localized = tf('bank.toast.csvTooLarge', 'This import is too large. Reduce the file size and try again.')
    } else if (code.includes('bank_import_date_')) {
      localized = tf('bank.toast.csvDateInvalid', 'The row has an invalid transaction date.')
    } else if (code.includes('bank_import_amount_') || code.includes('ledger_amount_must_be_nonzero') || code.includes('settlement_amount_must_be_positive')) {
      localized = tf('bank.toast.csvAmountInvalid', 'The row has an invalid amount at the supported two-decimal precision.')
    } else if (code.includes('bank_import_direction_')) {
      localized = tf('bank.toast.csvDirectionInvalid', 'The row direction does not match its settlement anchor.')
    } else if (code.includes('bank_import_currency_mismatch')) {
      localized = tf('bank.toast.csvCurrencyMismatch', 'The row currency does not match the selected bank account.')
    } else if (code.includes('bank_import_reference_invalid') || code.includes('settlement_anchor_required')) {
      localized = tf('bank.toast.csvReferenceInvalid', 'The row has an invalid settlement reference.')
    } else if (code.includes('settlement_already_resolved')) {
      localized = tf('bank.toast.alreadyResolved', 'This settlement anchor is already fully resolved. Refresh before posting.')
    } else if (code.includes('settlement_amount_exceeds_outstanding')) {
      localized = tf('bank.toast.amountTooHigh', 'The settlement amount exceeds the current outstanding balance.')
    } else if (code.includes('finance_document_became_active_anchor')) {
      localized = tf('bank.toast.financeAnchorChanged', 'A finance document is now the active settlement anchor. Refresh before posting.')
    } else if (code.includes('settlement_anchor_not_ready') || code.includes('settlement_anchor_not_found')) {
      localized = tf('bank.toast.anchorStale', 'This settlement anchor is no longer ready. Refresh before posting.')
    } else if (code.includes('insufficient_company_role')) {
      localized = tf('bank.toast.permissionDenied', 'You do not have permission to post bank transactions for this company.')
    } else if (code.includes('company_access_disabled')) {
      localized = tf('bank.toast.companyAccessDisabled', 'Company access is disabled, so bank posting is unavailable.')
    } else if (code.includes('cross_company')) {
      localized = tf('bank.toast.companyAccessDenied', 'Switch to the correct company before posting this transaction.')
    } else if (code.includes('bank_account_not_found')) {
      localized = tf('bank.toast.bankUnavailable', 'The selected bank account is no longer available. Refresh before posting.')
    }

    if (context === 'import' && detail.rowNumber && localized) {
      toast.error(tf('bank.toast.csvRowFailed', 'CSV row {row}: {reason}', {
        row: detail.rowNumber,
        reason: localized,
      }))
      return
    }

    toast.error(localized || (context === 'import'
      ? tf('bank.toast.csvImportFailed', 'The import could not be posted. No rows were committed.')
      : tf('bank.toast.txAddFailed', 'Failed to add transaction')))
  }

  async function parseSelectedCsv() {
    if (!csvFile) throw new Error('bank_import_file_required')
    const text = await csvFile.text()
    const lines = text
      .split(/\r?\n/)
      .map((line, index) => ({ line: line.trim(), rowNumber: index + 1 }))
      .filter(({ line }) => Boolean(line))
    if (lines.length === 0) throw new Error('bank_import_empty')

    const delimiter = detectDelimiter(lines[0].line)
    const header = lines[0].line.toLowerCase()
    const start = /(date|data)/.test(header) && /(amount|valor)/.test(header) ? 1 : 0
    const payload: BankImportRow[] = []
    for (let index = start; index < lines.length; index += 1) {
      const { line, rowNumber } = lines[index]
      const columns = splitCSVLine(line, delimiter)
      const happenedAt = normalizeDateDDMMYYYY(columns[0] ?? '')
      const amount = parseAmount(columns[2] ?? '')
      if (!happenedAt) throw Object.assign(new Error('bank_import_date_invalid'), { code: 'bank_import_date_invalid', rowNumber })
      const amountToken = amount === null ? null : normalizedMoneyToken(amount)
      if (!amountToken) throw Object.assign(new Error('bank_import_amount_invalid'), { code: 'bank_import_amount_invalid', rowNumber })
      payload.push({
        row_number: rowNumber,
        happened_at: happenedAt,
        memo: (columns[1] ?? '') || null,
        amount_base: amountToken,
        currency_code: currency || null,
        direction: 'ledger',
        ref_type: null,
        ref_id: null,
      })
    }
    if (!payload.length) throw new Error('bank_import_empty')
    if (payload.length > 500) throw new Error('bank_import_row_limit_exceeded')
    return payload
  }

  async function previewCsv() {
    setPreviewingCsv(true)
    setCsvPreviewRows([])
    setCsvPreviewError(null)
    try {
      const payload = await parseSelectedCsv()
      setCsvPreviewRows(payload)
    } catch (error) {
      console.error(error)
      const detail = bankImportErrorDetail(error)
      const message = detail.rowNumber
        ? tf('bank.toast.csvRowFailed', 'CSV row {row}: validation failed', { row: detail.rowNumber })
        : tf('bank.toast.csvImportFailed', 'The CSV could not be validated.')
      setCsvPreviewError(message)
    } finally {
      setPreviewingCsv(false)
    }
  }

  // ----- CSV import (DD/MM/YYYY) -----
  async function importCsv() {
    if (!canManageSettlement) {
      toast.error(tf('bank.toast.permissionDenied', 'You do not have permission to post bank transactions for this company.'))
      return
    }
    if (!companyId || !scopedBankId || !csvFile) { toast.error(tf('bank.toast.csvChoose', 'Choose a CSV file first')); return }
    if (!csvPreviewRows.length || csvPreviewError) {
      toast.error(tf('financeUx.previewRequired', 'Preview and validate the CSV before committing the import.'))
      return
    }
    if (currency !== baseCurrency) {
      toast.error(tf('financeUx.multiCurrencyImportBlocked', 'Import is unavailable because this account currency differs from the company base currency and no authoritative conversion amount is available.'))
      return
    }
    setImporting(true)
    try {
      const payload = csvPreviewRows
      const requestKey = await durableBankImportRequestKey(companyId, scopedBankId, payload)
      const { data, error } = await supabase.rpc('post_bank_ledger_import', {
        p_company_id: companyId,
        p_bank_id: scopedBankId,
        p_rows: payload,
        p_request_key: requestKey,
      })
      if (error) throw error

      const result = Array.isArray(data) ? data[0] : data
      const importedCount = Number(result?.row_count || payload.length)
      toast.success(result?.replayed
        ? tf('bank.toast.csvReplayRestored', 'This import was already posted. No duplicate bank rows were created.')
        : tf('bank.toast.csvImported', 'Imported {count} rows', { count: importedCount }))
      setCsvFile(null)
      setCsvPreviewRows([])
      setCsvPreviewError(null)
      await loadTx()
      await loadBookBalance()
    } catch (e: any) {
      console.error(e)
      showBankPostingError(e, 'import')
    } finally {
      setImporting(false)
    }
  }

  // Manual transaction add
  async function addTx() {
    if (!canManageSettlement) {
      toast.error(tf('bank.toast.permissionDenied', 'You do not have permission to post bank transactions for this company.'))
      return
    }
    if (!scopedBankId) return
    const amt = normalizeMoneyValue(Number(txAmt))
    if (!Number.isFinite(amt) || amt === 0) { toast.error(tf('bank.toast.amountNonZero', 'Amount must be a non-zero number')); return }
    setAddingTx(true)
    try {
      const requestFingerprint = stablePostingFingerprint({
        amountBase: amt,
        bankId: scopedBankId,
        companyId,
        happenedAt: txDate,
        memo: txMemo.trim() || null,
      })
      const requestKey = getPostingRequestKeyForFingerprint(bankManualPostingRequestRef, requestFingerprint)
      const { data, error } = await supabase.rpc('post_bank_ledger_transaction', {
        p_company_id: companyId,
        p_bank_id: scopedBankId,
        p_happened_at: txDate,
        p_amount_base: amt,
        p_memo: txMemo.trim() || null,
        p_request_key: requestKey,
      })
      if (error) {
        throw error
      }
      setTxMemo(''); setTxAmt('0'); setTxDate(todayISO())
      clearPostingRequestKey(bankManualPostingRequestRef)
      await loadTx()
      await loadBookBalance()
      toast.success((Array.isArray(data) ? data[0] : data)?.replayed
        ? tf('bank.toast.replayRestored', 'The earlier transaction was already posted. Its original result has been restored.')
        : tf('bank.toast.txAdded', 'Transaction added'))
    } catch (e: any) {
      console.error(e)
      showBankPostingError(e, 'manual')
    } finally {
      setAddingTx(false)
    }
  }

  const referenceHref = (type: Tx['ref_type'], id: string | null | undefined) => {
    if (!id) return null
    if (type === 'SI') return `/sales-invoices/${id}`
    if (type === 'VB') return `/vendor-bills/${id}`
    if (type === 'SO') return `/orders?tab=sales&orderId=${encodeURIComponent(id)}`
    if (type === 'PO') return `/orders?tab=purchase&orderId=${encodeURIComponent(id)}`
    return null
  }

  const safeReference = (type: Tx['ref_type'], id: string | null | undefined) => {
    if (!type || !id || !orderRefByKey[`${type}:${id}`]) return tf('financeUx.unresolvedReference', 'Unresolved reference')
    return formatOrderReference(type, id, orderRefByKey, tf('financeUx.unresolvedReference', 'Unresolved reference'))
  }

  const buildBankExport = async (kind: 'ledger' | 'reconciliation'): Promise<FinanceExportModel> => {
    if (!companyId || !bank || transactionsError || bookBalanceError || bookBalance === null) {
      throw new Error('bank_export_evidence_unavailable')
    }
    if (kind === 'reconciliation' && (statementsError || !selectedStatement)) {
      throw new Error('bank_reconciliation_statement_required')
    }
    const company = await loadFinanceExportCompany(companyId)
    const bankContext = {
      name: bank.name,
      bankName: bank.bank_name,
      maskedAccountNumber: maskFinanceAccountNumber(bank.account_number),
      operatingCurrency: bank.currency_code || baseCurrency,
      swift: bank.swift,
    }
    const inflows = rows.reduce((sum, row) => sum + (row.amount_base > 0 ? row.amount_base : 0), 0)
    const outflows = rows.reduce((sum, row) => sum + (row.amount_base < 0 ? Math.abs(row.amount_base) : 0), 0)
    const common = {
      language: lang === 'pt' ? 'pt' as const : 'en' as const,
      generatedAt: new Date().toISOString(),
      generatedBy: user?.email || null,
      company,
      bank: bankContext,
      period: { from, to },
      filters: [onlyUnreconciled ? tf('bank.notReconciled', 'Unreconciled only') : tf('financeUx.allTransactions', 'All transactions')],
      baseCurrency,
    }
    const transactionSection = {
      title: tf('bank.transactions', 'Bank ledger'),
      columns: [
        { key: 'date', label: tf('table.date', 'Date'), width: 14 },
        { key: 'reference', label: tf('table.ref', 'Reference'), width: 22 },
        { key: 'memo', label: tf('bank.memo', 'Memo'), width: 36 },
        { key: 'inflow', label: tf('financeUx.inflowBase', 'Inflow (base)'), width: 16, type: 'currency' as const },
        { key: 'outflow', label: tf('financeUx.outflowBase', 'Outflow (base)'), width: 16, type: 'currency' as const },
        { key: 'reconciled', label: tf('bank.reconciled', 'Reconciled'), width: 16 },
      ],
      rows: rows.map((row) => ({
        date: row.happened_at,
        reference: safeReference(row.ref_type, row.ref_id),
        memo: row.memo || '',
        inflow: row.amount_base > 0 ? row.amount_base : null,
        outflow: row.amount_base < 0 ? Math.abs(row.amount_base) : null,
        reconciled: row.reconciled ? tf('bank.reconciled', 'Reconciled') : tf('bank.notReconciled', 'Unreconciled'),
      })),
    }
    if (kind === 'ledger') {
      return {
        context: {
          ...common,
          title: tf('financeUx.bankLedgerReport', 'Bank Ledger Report'),
          subtitle: tf('financeUx.currentFilteredView', 'Current filtered view'),
          disclaimer: tf('financeUx.bankLedgerDisclaimer', 'This report reflects StockWise bank-ledger evidence in company base currency.'),
        },
        summary: [
          { label: tf('bank.bookBalance', 'Book balance'), value: bookBalance, type: 'currency' },
          { label: tf('cash.inflows', 'Inflows'), value: inflows, type: 'currency' },
          { label: tf('cash.outflows', 'Outflows'), value: outflows, type: 'currency' },
          { label: tf('financeUx.transactionCount', 'Transaction count'), value: rows.length, type: 'number' },
        ],
        sections: [transactionSection],
        filename: sanitizeFinanceFilename(`StockWise_Bank_Ledger_${bank.name}_${from}_${to}`),
        orientation: 'landscape',
      }
    }
    const reconciledCount = rows.filter((row) => row.reconciled).length
    return {
      context: {
        ...common,
        title: tf('financeUx.bankReconciliationReport', 'Bank Reconciliation Report'),
        subtitle: `${tf('financeUx.selectedStatement', 'Selected statement')}: ${selectedStatement!.statement_date}`,
        disclaimer: tf('financeUx.bankReconciliationDisclaimer', 'This report reflects StockWise bank-ledger and statement evidence. It is not a bank-issued statement.'),
      },
      summary: [
        { label: tf('bank.bookBalance', 'Book balance'), value: bookBalance, type: 'currency' },
        { label: tf('bank.statementBalance', 'Statement closing balance'), value: selectedStatement!.closing_balance_base, type: 'currency' },
        { label: tf('bank.difference', 'Difference'), value: diff!, type: 'currency' },
        { label: tf('financeUx.transactionCount', 'Transaction count'), value: rows.length, type: 'number' },
        { label: tf('financeUx.reconciledCount', 'Reconciled'), value: reconciledCount, type: 'number' },
        { label: tf('financeUx.unreconciledCount', 'Unreconciled'), value: rows.length - reconciledCount, type: 'number' },
        { label: tf('cash.inflows', 'Inflows'), value: inflows, type: 'currency' },
        { label: tf('cash.outflows', 'Outflows'), value: outflows, type: 'currency' },
      ],
      sections: [
        {
          title: tf('financeUx.statementEvidence', 'Statement evidence'),
          columns: [
            { key: 'date', label: tf('bank.statementDate', 'Statement date'), width: 18 },
            { key: 'closing', label: tf('bank.statementBalance', 'Closing balance'), width: 18, type: 'currency' as const },
            { key: 'file', label: tf('financeUx.fileEvidence', 'File evidence'), width: 18 },
            { key: 'status', label: tf('financeUx.statementStatus', 'Statement status'), width: 18 },
          ],
          rows: [{
            date: selectedStatement!.statement_date,
            closing: selectedStatement!.closing_balance_base,
            file: selectedStatement!.file_path ? tf('financeUx.present', 'Present') : tf('financeUx.notAttached', 'Not attached'),
            status: selectedStatement!.reconciled ? tf('bank.reconciled', 'Reconciled') : tf('bank.notReconciled', 'Unreconciled'),
          }],
        },
        transactionSection,
      ],
      filename: sanitizeFinanceFilename(`StockWise_Bank_Reconciliation_${bank.name}_${selectedStatement!.statement_date}`),
      orientation: 'landscape',
    }
  }

  const generateExport = async (format: FinanceExportFormat) => {
    if (!exportKind) return
    const model = await buildBankExport(exportKind)
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

  if (bankLoading) {
    return <div className="app-page app-page--workspace"><PremiumStatePanel variant="loading" title={tf('financeUx.loadingBankAccount', 'Loading bank account')} /></div>
  }
  if (bankError || !bank) {
    return (
      <div className="app-page app-page--workspace space-y-4">
        <PremiumStatePanel
          variant="error"
          title={tf('financeUx.bankAccountUnavailable', 'Bank account unavailable')}
          description={tf('financeUx.bankAccountUnavailableHelp', 'The account does not belong to the active company or its evidence could not be loaded.')}
        />
        <Button asChild variant="outline"><Link to="/banks">{tf('financeUx.backToBanks', 'Back to bank accounts')}</Link></Button>
      </div>
    )
  }

  return (
    <div className="app-page app-page--workspace space-y-6 overflow-x-hidden">
      {/* Header + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{bank?.name ?? t('banks.title')}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{bank.bank_name || tf('banks.noBankName', 'Bank name not recorded')}</span>
            <span aria-hidden="true">·</span>
            <span>{maskFinanceAccountNumber(bank.account_number) || tf('common.dash', '-')}</span>
            <Badge variant="outline">{tf('financeUx.accountOperatingCurrency', 'Account operating currency')}: {currency}</Badge>
            <Badge variant="outline">{tf('financeUx.companyBaseCurrency', 'Company base currency')}: {baseCurrency}</Badge>
            <Badge variant="outline">{companyName || tf('company.selectCompany', 'Select company')}</Badge>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
          <div className="min-w-0">
            <Label>{t('filters.from')}</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="min-w-0">
            <Label>{t('filters.to')}</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:ml-2">
            <input
              id="unrec"
              type="checkbox"
              className="h-4 w-4"
              checked={onlyUnreconciled}
              onChange={e => setOnlyUnreconciled(e.target.checked)}
            />
            <Label htmlFor="unrec">{t('bank.notReconciled')}</Label>
          </div>
        </div>
      </div>

      <nav aria-label={tf('financeUx.bankViews', 'Bank account views')} className="flex flex-wrap gap-2">
        {([
          ['ledger', tf('financeUx.ledger', 'Ledger')],
          ['reconciliation', tf('financeUx.reconciliation', 'Reconciliation')],
          ['statements', tf('bank.statements', 'Statements')],
          ['import', tf('financeUx.import', 'Import')],
          ['settings', tf('settings.title', 'Settings')],
        ] as const).map(([key, label]) => (
          <Button key={key} variant={view === key ? 'default' : 'outline'} onClick={() => setView(key)} aria-current={view === key ? 'page' : undefined}>
            {label}
          </Button>
        ))}
      </nav>

      {/* Bank master data */}
      {view === 'settings' ? <Card>
        <CardHeader><CardTitle>{t('bank.details')}</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-3">
          {/* NEW: Nickname */}
          <div>
            <Label>{t('banks.nickname')}</Label>
            <Input
              value={bank?.name ?? ''}
              onChange={e => setBank(b => (b ? { ...b, name: e.target.value } : b))}
              disabled={!canEditBank}
              placeholder={tf('banks.placeholder.nickname', 'e.g., Main MZN Account')}
            />
          </div>

          <div>
            <Label>{t('banks.bankName')}</Label>
            <Input
              value={bank?.bank_name ?? ''}
              onChange={e => setBank(b => (b ? { ...b, bank_name: e.target.value } : b))}
              disabled={!canEditBank}
              placeholder={tf('banks.placeholder.bankName', 'e.g., Standard Bank')}
            />
          </div>
          <div>
            <Label>{t('banks.accountNumber')}</Label>
            <Input
              value={bank?.account_number ?? ''}
              onChange={e => setBank(b => (b ? { ...b, account_number: e.target.value } : b))}
              disabled={!canEditBank}
              placeholder={tf('banks.placeholder.accountNumber', '########')}
            />
          </div>
          <div>
            <Label>{t('banks.currencyCode')}</Label>
            <Input
              value={bank?.currency_code ?? ''}
              onChange={e => setBank(b => (b ? { ...b, currency_code: e.target.value.toUpperCase() } : b))}
              disabled={!canEditBank}
              placeholder={baseCurrency || 'MZN'}
            />
          </div>
          <div>
            <Label>{t('banks.swift')}</Label>
            <Input
              value={bank?.swift ?? ''}
              onChange={e => setBank(b => (b ? { ...b, swift: e.target.value.toUpperCase() } : b))}
              disabled={!canEditBank}
              placeholder={tf('banks.placeholder.swift', 'e.g., SBICMZMX')}
            />
          </div>
          <div>
            <Label>{t('banks.nib')}</Label>
            <Input
              value={bank?.nib ?? ''}
              onChange={e => setBank(b => (b ? { ...b, nib: e.target.value } : b))}
              disabled={!canEditBank}
              placeholder={tf('banks.placeholder.nib', 'e.g., 0003.0101.00014850100852')}
            />
          </div>
          <div>
            <Label>{t('banks.taxNumber')}</Label>
            <Input
              value={bank?.tax_number ?? ''}
              onChange={e => setBank(b => (b ? { ...b, tax_number: e.target.value } : b))}
              disabled={!canEditBank}
              placeholder={tf('banks.placeholder.taxNumber', 'e.g., 400073414')}
            />
          </div>

          <div className="md:col-span-3">
            <Button className="w-full sm:w-auto" onClick={saveBankDetails} disabled={!canEditBank}>
              {canEditBank ? t('bank.saveDetails') : t('bank.viewOnly')}
            </Button>
          </div>
        </CardContent>
      </Card> : null}

      {view === 'reconciliation' ? (
        <div className="space-y-4">
          {statementsError ? (
            <PremiumStatePanel variant="error" title={tf('financeUx.statementEvidenceUnavailable', 'Statement evidence unavailable')} description={tf('financeUx.statementEvidenceUnavailableHelp', 'No statement or reconciliation difference has been inferred.')} />
          ) : statementsLoading ? (
            <PremiumStatePanel variant="loading" title={tf('financeUx.loadingStatements', 'Loading statements')} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{tf('financeUx.selectedStatement', 'Selected statement')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor="selected-statement">{tf('financeUx.statementForReconciliation', 'Statement for reconciliation')}</Label>
                  <select
                    id="selected-statement"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={selectedStatementId || ''}
                    onChange={(event) => setSelectedStatementId(event.target.value || null)}
                  >
                    <option value="">{tf('financeUx.selectStatement', 'Select a statement')}</option>
                    {statements.map((statement) => (
                      <option key={statement.id} value={statement.id}>
                        {statement.statement_date} · {formatMoneyBase(statement.closing_balance_base, baseCurrency)} · {statement.reconciled ? tf('bank.reconciled', 'Reconciled') : tf('bank.notReconciled', 'Unreconciled')}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="outline"
                  disabled={!selectedStatement || transactionsError || bookBalanceError}
                  onClick={() => setExportKind('reconciliation')}
                >
                  {tf('financeUx.exportBankReconciliation', 'Export Bank Reconciliation')}
                </Button>
              </CardContent>
            </Card>
          )}

          {!selectedStatement && !statementsLoading && !statementsError ? (
            <PremiumStatePanel
              variant="empty"
              title={tf('financeUx.selectStatementTitle', 'Select a statement to begin reconciliation')}
              description={tf('financeUx.selectStatementHelp', 'StockWise will not assume which statement should be compared with the bank book.')}
            />
          ) : null}

          {selectedStatement ? (
            <div className="grid gap-3 md:grid-cols-3">
              <Card><CardHeader><CardTitle>{t('bank.bookBalance')}</CardTitle></CardHeader><CardContent className="text-2xl">{bookBalanceLoading ? tf('common.loading', 'Loading...') : bookBalanceError || bookBalance === null ? tf('common.unavailable', 'Unavailable') : formatMoneyBase(bookBalance, baseCurrency)}</CardContent></Card>
              <Card><CardHeader><CardTitle>{t('bank.statementBalance')}</CardTitle></CardHeader><CardContent className="text-2xl">{formatMoneyBase(selectedStatement.closing_balance_base, baseCurrency)}</CardContent></Card>
              <Card><CardHeader><CardTitle>{t('bank.difference')}</CardTitle></CardHeader><CardContent className="text-2xl">{diff === null ? tf('common.unavailable', 'Unavailable') : formatMoneyBase(diff, baseCurrency)}</CardContent></Card>
            </div>
          ) : null}
        </div>
      ) : null}

      {view === 'reconciliation' && selectedStatement ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>{tf('financeUx.transactionReconciliation', 'Transaction reconciliation')}</CardTitle>
          </CardHeader>
          <CardContent>
            {transactionsLoading ? <PremiumStatePanel variant="loading" title={tf('financeUx.loadingBankLedger', 'Loading Bank Ledger')} /> : transactionsError ? (
              <PremiumStatePanel variant="error" title={tf('financeUx.bankLedgerUnavailable', 'Bank Ledger unavailable')} description={tf('financeUx.bankLedgerUnavailableHelp', 'No transaction reconciliation status has been inferred.')} />
            ) : rows.length === 0 ? (
              <PremiumStatePanel variant="empty" title={tf('bank.noTx', 'No bank transactions match the current filters.')} />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {rows.map((row) => (
                  <article key={row.id} className="rounded-lg border border-border/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{row.memo || tf('financeUx.bankLedgerEntry', 'Bank ledger entry')}</p>
                        <p className="text-sm text-muted-foreground">{row.happened_at} · {safeReference(row.ref_type, row.ref_id)}</p>
                      </div>
                      <Badge variant={row.reconciled ? 'secondary' : 'outline'}>{row.reconciled ? tf('bank.reconciled', 'Reconciled') : tf('bank.notReconciled', 'Unreconciled')}</Badge>
                    </div>
                    <p className="mt-3 text-lg font-semibold">{formatMoneyBase(row.amount_base, baseCurrency)}</p>
                    <Button className="mt-3" size="sm" variant="outline" disabled={!canManageSettlement || savingTx === row.id} onClick={() => toggleReconciled(row.id, !row.reconciled)}>
                      {row.reconciled ? tf('financeUx.markUnreconciled', 'Mark unreconciled') : t('bank.markReconciled')}
                    </Button>
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Transactions */}
      {view === 'ledger' ? <Card className="overflow-hidden">
        <CardHeader className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-start lg:justify-between">
          <CardTitle>{t('bank.transactions')}</CardTitle>
          <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-end">
            {/* Manual entry */}
            <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_auto] sm:items-end">
              <div className="min-w-0">
                <Label>{t('table.date')}</Label>
                <Input type="date" value={txDate} onChange={e => setTxDate(e.target.value)} />
              </div>
              <div className="min-w-0">
                <Label>{t('bank.memo')}</Label>
                <Input value={txMemo} onChange={e => setTxMemo(e.target.value)} placeholder={tf('bank.placeholder.memo', 'e.g., Bank fee')} />
              </div>
              <div className="min-w-0">
                <Label>{tf('financeUx.amountCompanyBase', 'Amount in company base currency ({code})', { code: baseCurrency })}</Label>
                <Input inputMode="decimal" value={txAmt} onChange={e => setTxAmt(e.target.value)} placeholder={tf('bank.placeholder.amount', '-120.00')} />
              </div>
              <Button className="w-full sm:w-auto" onClick={addTx} disabled={!canManageSettlement || addingTx}>{addingTx ? t('actions.saving') : t('cash.add')}</Button>
            </div>

            <Button variant="outline" disabled={transactionsError || bookBalanceError} onClick={() => setExportKind('ledger')}>
              {tf('financeUx.exportBankLedger', 'Export Bank Ledger')}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          {!canManageSettlement ? (
            <div className="mb-4 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              {tf('bank.financeAuthorityNotice', 'Only finance-authority users can post bank ledger transactions or import statement rows.')}
            </div>
          ) : null}
          {/* List */}
          {transactionsLoading ? <PremiumStatePanel variant="loading" title={tf('financeUx.loadingBankLedger', 'Loading Bank Ledger')} /> : transactionsError ? (
            <PremiumStatePanel variant="error" title={tf('financeUx.bankLedgerUnavailable', 'Bank Ledger unavailable')} description={tf('financeUx.bankLedgerUnavailableHelp', 'An empty ledger and zero balance have not been inferred.')} />
          ) : rows.length === 0 ? (
            <PremiumStatePanel variant="empty" title={t('bank.noTx')} />
          ) : <>
            <div className="grid gap-3 sm:hidden">
              {rows.map((row) => (
                <article key={row.id} className="rounded-lg border border-border/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-medium">{row.memo || tf('financeUx.bankLedgerEntry', 'Bank ledger entry')}</p><p className="mt-1 text-sm text-muted-foreground">{row.happened_at}</p></div>
                    <Badge variant={row.reconciled ? 'secondary' : 'outline'}>{row.reconciled ? t('bank.reconciled') : t('bank.notReconciled')}</Badge>
                  </div>
                  <p className="mt-3 text-xl font-semibold">{formatMoneyBase(row.amount_base, baseCurrency)}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{safeReference(row.ref_type, row.ref_id)}</p>
                  <Button className="mt-3" variant="outline" size="sm" onClick={() => toggleReconciled(row.id, !row.reconciled)} disabled={!canManageSettlement || savingTx === row.id}>
                    {row.reconciled ? tf('financeUx.markUnreconciled', 'Mark unreconciled') : t('bank.markReconciled')}
                  </Button>
                </article>
              ))}
            </div>
            <table className="hidden w-full text-sm sm:table">
            <thead className="text-left sticky top-0 bg-background">
              <tr>
                <th className="py-2 pr-3">{t('table.date')}</th>
                <th className="py-2 pr-3">{t('table.ref')}</th>
                <th className="py-2 pr-3">{t('bank.memo')}</th>
                <th className="py-2 pr-3 text-right">{tf('financeUx.amountCompanyBase', 'Amount in company base currency ({code})', { code: baseCurrency })}</th>
                <th className="py-2 pl-3 text-right">{t('bank.reconciled')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-3">{r.happened_at}</td>
                  <td className="py-2 pr-3">
                    {referenceHref(r.ref_type, r.ref_id) ? (
                      <Link className="text-primary underline-offset-4 hover:underline" to={referenceHref(r.ref_type, r.ref_id)!}>
                        {safeReference(r.ref_type, r.ref_id)}
                      </Link>
                    ) : (
                      safeReference(r.ref_type, r.ref_id)
                    )}
                  </td>
                  <td className="py-2 pr-3">{r.memo ?? t('common.dash')}</td>
                  <td className="py-2 pr-3 text-right">{formatMoneyBase(r.amount_base, baseCurrency)}</td>
                  <td className="py-2 pl-3 text-right">
                    <Button
                      variant={r.reconciled ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() => toggleReconciled(r.id, !r.reconciled)}
                      disabled={!canManageSettlement || savingTx === r.id}
                    >
                      {r.reconciled ? t('bank.reconciled') : t('bank.markReconciled')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>}
        </CardContent>
      </Card> : null}

      {view === 'import' ? (
        <Card>
          <CardHeader>
            <CardTitle>{tf('financeUx.importBankLedger', 'Import Bank Ledger')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{t('bank.csv.header')}</p>
              <p className="mt-1">{tf('financeUx.bankImportContract', 'CSV rows require date, memo, and amount. Validation is all-or-nothing, limited to 500 rows, and preserves idempotent replay.')}</p>
              <p className="mt-1">{tf('financeUx.bankImportCurrency', 'The CSV currency must match the account operating currency. Posted ledger values remain company-base-currency evidence.')}</p>
              {currency !== baseCurrency ? (
                <p className="mt-2 font-medium text-amber-700 dark:text-amber-300">{tf('financeUx.multiCurrencyImportBlocked', 'Import is unavailable because this account currency differs from the company base currency and no authoritative conversion amount is available.')}</p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <div className="space-y-2">
                <Label>{t('bank.csv.fileLabel')}</Label>
                <Input type="file" accept=".csv" onChange={e => {
                  setCsvFile(e.target.files?.[0] ?? null)
                  setCsvPreviewRows([])
                  setCsvPreviewError(null)
                }} />
              </div>
              <Button variant="outline" onClick={previewCsv} disabled={previewingCsv || !csvFile || currency !== baseCurrency}>
                {previewingCsv ? tf('financeUx.previewing', 'Validating...') : tf('financeUx.previewImport', 'Preview import')}
              </Button>
              <Button onClick={importCsv} disabled={!canManageSettlement || importing || !csvPreviewRows.length || Boolean(csvPreviewError) || currency !== baseCurrency}>
                {importing ? t('bank.csv.importing') : tf('financeUx.commitImport', 'Commit import')}
              </Button>
            </div>
            {csvPreviewError ? (
              <PremiumStatePanel variant="error" title={tf('financeUx.importValidationFailed', 'Import validation failed')} description={csvPreviewError} />
            ) : null}
            {csvPreviewRows.length ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-positive/30 bg-positive/10 px-4 py-3 text-sm text-positive">
                  {tf('financeUx.importPreviewReady', '{count} rows passed local validation. Commit remains an atomic governed database operation.', { count: csvPreviewRows.length })}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left"><th className="py-2 pr-3">{t('table.date')}</th><th className="py-2 pr-3">{t('bank.memo')}</th><th className="py-2 text-right">{tf('financeUx.amountCompanyBase', 'Amount in company base currency ({code})', { code: baseCurrency })}</th></tr></thead>
                    <tbody>{csvPreviewRows.slice(0, 10).map((row) => <tr key={row.row_number} className="border-b border-border/60"><td className="py-2 pr-3">{row.happened_at}</td><td className="py-2 pr-3">{row.memo || tf('common.dash', '-')}</td><td className="py-2 text-right">{formatMoneyBase(Number(row.amount_base), baseCurrency)}</td></tr>)}</tbody>
                  </table>
                </div>
                {csvPreviewRows.length > 10 ? <p className="text-sm text-muted-foreground">{tf('financeUx.previewLimited', 'Preview shows the first 10 validated rows. All {count} rows will be committed atomically.', { count: csvPreviewRows.length })}</p> : null}
              </div>
            ) : null}
            {!canManageSettlement ? (
              <p className="text-sm text-muted-foreground">{tf('bank.financeAuthorityNotice', 'Only finance-authority users can import bank ledger rows.')}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Statements */}
      {view === 'statements' ? <Card>
        <CardHeader><CardTitle>{t('bank.statements')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-4 gap-3 items-end">
            <div>
              <Label>{t('bank.statementDate')}</Label>
              <Input type="date" value={stDate} onChange={e => setStDate(e.target.value)} />
            </div>
            <div>
              <Label>{tf('financeUx.statementClosingBase', 'Statement closing balance in company base currency ({code})', { code: baseCurrency })}</Label>
              <Input inputMode="decimal" value={stClosing} onChange={e => setStClosing(e.target.value)} />
            </div>
            <div>
              <Label>{t('bank.file')}</Label>
              <Input type="file" onChange={e => setStFile(e.target.files?.[0] ?? null)} />
            </div>
            <div>
              <Button onClick={uploadStatement} disabled={!canManageSettlement || uploading}>
                {uploading ? t('bank.uploading') : t('bank.saveStatement')}
              </Button>
            </div>
          </div>

          {statementsLoading ? <PremiumStatePanel variant="loading" title={tf('financeUx.loadingStatements', 'Loading statements')} /> : statementsError ? (
            <PremiumStatePanel variant="error" title={tf('financeUx.statementEvidenceUnavailable', 'Statement evidence unavailable')} description={tf('financeUx.statementEvidenceUnavailableHelp', 'No empty statement register has been inferred.')} />
          ) : statements.length === 0 ? (
            <PremiumStatePanel variant="empty" title={t('bank.noStatements')} />
          ) : <>
            <div className="grid gap-3 sm:hidden">
              {statements.map((statement) => (
                <article key={statement.id} className="rounded-lg border border-border/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-medium">{statement.statement_date}</p><p className="mt-1 text-xl font-semibold">{formatMoneyBase(statement.closing_balance_base, baseCurrency)}</p></div>
                    <Badge variant={statement.reconciled ? 'secondary' : 'outline'}>{statement.reconciled ? t('bank.reconciled') : t('bank.notReconciled')}</Badge>
                  </div>
                  <div className="mt-4 grid gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setSelectedStatementId(statement.id); setView('reconciliation') }}>{tf('financeUx.selectForReconciliation', 'Select for reconciliation')}</Button>
                    {statement.file_path ? <Button variant="outline" size="sm" onClick={() => openFile(statement.file_path!)}>{t('bank.view')}</Button> : null}
                    <Button variant="outline" size="sm" disabled={!canManageSettlement} onClick={() => toggleStatementReconciled(statement)}>{statement.reconciled ? tf('financeUx.markUnreconciled', 'Mark unreconciled') : t('bank.markReconciled')}</Button>
                    <Button variant="destructive" size="sm" disabled={statement.reconciled || !canManageSettlement} onClick={() => deleteStatement(statement)}>{t('bank.delete')}</Button>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr>
                  <th className="py-2 pr-3">{t('table.date')}</th>
                  <th className="py-2 pr-3 text-right">{tf('financeUx.statementClosingBase', 'Statement closing balance ({code})', { code: baseCurrency })}</th>
                  <th className="py-2 pr-3">{t('bank.file')}</th>
                  <th className="py-2 pr-3">{t('bank.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {statements.map(s => (
                  <tr key={s.id} className="border-t">
                    <td className="py-2 pr-3">{s.statement_date}</td>
                    <td className="py-2 pr-3 text-right">{formatMoneyBase(s.closing_balance_base, baseCurrency)}</td>
                    <td className="py-2 pr-3">
                      {s.file_path ? (
                        <Button variant="link" className="px-0" onClick={() => openFile(s.file_path!)}>{t('bank.view')}</Button>
                      ) : t('common.dash')}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant={selectedStatementId === s.id ? 'secondary' : 'outline'}
                          size="sm"
                          onClick={() => {
                            setSelectedStatementId(s.id)
                            setView('reconciliation')
                          }}
                        >
                          {selectedStatementId === s.id ? tf('financeUx.selected', 'Selected') : tf('financeUx.selectForReconciliation', 'Select for reconciliation')}
                        </Button>
                        <Button
                          variant={s.reconciled ? 'secondary' : 'outline'}
                          size="sm"
                          disabled={!canManageSettlement}
                          onClick={() => toggleStatementReconciled(s)}
                        >
                          {s.reconciled ? t('bank.reconciled') : t('bank.notReconciled')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={s.reconciled || !canManageSettlement}
                          onClick={() => deleteStatement(s)}
                        >
                          {t('bank.delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>}
        </CardContent>
      </Card> : null}

      <FinanceExportDialog
        open={Boolean(exportKind)}
        onOpenChange={(open) => {
          if (!open) setExportKind(null)
        }}
        title={exportKind === 'reconciliation'
          ? tf('financeUx.bankReconciliationReport', 'Bank Reconciliation Report')
          : tf('financeUx.bankLedgerReport', 'Bank Ledger Report')}
        description={tf('financeUx.exportConfirmation', 'Confirm the evidence scope before generating the file.')}
        scope={exportKind === 'reconciliation'
          ? tf('financeUx.oneBankReconciliation', 'One bank reconciliation')
          : tf('financeUx.currentFilteredView', 'Current filtered view')}
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
