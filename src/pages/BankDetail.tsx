// src/pages/BankDetail.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  const { t } = useI18n()
  const { bankId: bankIdA, id: bankIdB } = useParams()
  const bankId = bankIdA ?? bankIdB
  const { myRole, companyId } = useOrg()
  const tf = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const canEditBank = hasRole(myRole, CanManageUsers)
  const canManageSettlement = financeCan.settlementSensitive(myRole)

  const [bank, setBank] = useState<Bank | null>(null)
  const [from, setFrom] = useState<string>(monthStartISO())
  const [to, setTo] = useState<string>(todayISO())
  const [rows, setRows] = useState<Tx[]>([])
  const [orderRefByKey, setOrderRefByKey] = useState<Record<string, string>>({})
  const [onlyUnreconciled, setOnlyUnreconciled] = useState<boolean>(false)
  const [statements, setStatements] = useState<Statement[]>([])
  const [bookBalance, setBookBalance] = useState<number>(0)
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
  const [importing, setImporting] = useState(false)

  // Manual transaction form
  const [txDate, setTxDate] = useState<string>(todayISO())
  const [txMemo, setTxMemo] = useState<string>('')
  const [txAmt, setTxAmt] = useState<string>('0')
  const [addingTx, setAddingTx] = useState(false)

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

  const diff = useMemo(() => {
    const stmt = statements.find(s => s.reconciled) || statements[0]
    const stBal = stmt?.closing_balance_base ?? 0
    return bookBalance - stBal
  }, [bookBalance, statements])

  useEffect(() => {
    if (!bankId || !companyId) {
      setBank(null)
      return
    }
    loadBank()
  }, [bankId, companyId])

  useEffect(() => {
    if (!scopedBankId) {
      setRows([])
      setStatements([])
      setBookBalance(0)
      setOrderRefByKey({})
      return
    }
    loadTx()
    loadStatements()
    loadBookBalance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedBankId, from, to, onlyUnreconciled])

  async function loadBank() {
    if (!bankId || !companyId) return
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('id, company_id, name, bank_name, account_number, currency_code, tax_number, swift, nib')
      .eq('id', bankId)
      .eq('company_id', companyId)
      .maybeSingle()
    if (error) { console.warn('bank_accounts not ready:', error.message); return }
    setBank(data as Bank)
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
    if (error) { console.warn('bank_transactions not ready:', error.message); setRows([]); setOrderRefByKey({}); return }
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
  }

  async function loadStatements() {
    if (!scopedBankId) return
    const myReq = ++latestStmtReq.current
    const { data, error } = await supabase
      .from('bank_statements')
      .select('id, bank_id, statement_date, closing_balance_base, file_path, reconciled, created_at')
      .eq('bank_id', scopedBankId)
      .order('statement_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (myReq !== latestStmtReq.current) return
    if (error) { console.warn('bank_statements not ready:', error.message); setStatements([]); return }
    setStatements(data as Statement[])
  }

  async function loadBookBalance() {
    if (!scopedBankId) return
    const myReq = ++latestBalReq.current
    const { data, error } = await supabase.rpc('bank_book_balance', { p_bank: scopedBankId })
    if (myReq !== latestBalReq.current) return
    if (error) { console.warn('bank_book_balance not ready:', error.message); setBookBalance(0); return }
    setBookBalance(typeof data === 'number' ? data : (data as any)?.balance ?? 0)
  }

  async function toggleReconciled(txId: string, value: boolean) {
    if (!scopedBankId) return
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
    if (!scopedBankId) return
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
    if (!scopedBankId || s.bank_id !== scopedBankId) return
    if (s.reconciled) {
      toast.error(tf('bank.toast.statementLocked', 'Reconciled statements cannot be deleted'))
      return
    }
    setStatements(prev => prev.filter(x => x.id !== s.id))
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

  // ----- CSV import (DD/MM/YYYY) -----
  async function importCsv() {
    if (!canManageSettlement) {
      toast.error(tf('bank.toast.permissionDenied', 'You do not have permission to post bank transactions for this company.'))
      return
    }
    if (!companyId || !scopedBankId || !csvFile) { toast.error(tf('bank.toast.csvChoose', 'Choose a CSV file first')); return }
    setImporting(true)
    try {
      const text = await csvFile.text()
      const lines = text
        .split(/\r?\n/)
        .map((line, index) => ({ line: line.trim(), rowNumber: index + 1 }))
        .filter(({ line }) => Boolean(line))
      if (lines.length === 0) { toast.error(tf('bank.toast.csvEmpty', 'Empty CSV')); return }

      const delim = detectDelimiter(lines[0].line)
      let start = 0
      const header = lines[0].line.toLowerCase()
      if (/(date|data)/.test(header) && /(amount|valor)/.test(header)) start = 1

      const payload: BankImportRow[] = []
      for (let i = start; i < lines.length; i++) {
        const { line, rowNumber } = lines[i]
        const cols = splitCSVLine(line, delim)
        const isoDate = normalizeDateDDMMYYYY(cols[0] ?? '')
        const amt = parseAmount(cols[2] ?? '')
        if (!isoDate) {
          throw Object.assign(new Error('bank_import_date_invalid'), {
            code: 'bank_import_date_invalid',
            rowNumber,
          })
        }
        const amountToken = amt === null ? null : normalizedMoneyToken(amt)
        if (!amountToken) {
          throw Object.assign(new Error('bank_import_amount_invalid'), {
            code: 'bank_import_amount_invalid',
            rowNumber,
          })
        }
        payload.push({
          row_number: rowNumber,
          happened_at: isoDate,
          memo: (cols[1] ?? '') || null,
          amount_base: amountToken,
          currency_code: currency || null,
          direction: 'ledger',
          ref_type: null,
          ref_id: null,
        })
      }
      if (!payload.length) { toast.error(tf('bank.toast.csvNoRows', 'No valid rows to import')); return }

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

  return (
    <div className="space-y-4 overflow-x-hidden">
      {/* Header + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{bank?.name ?? t('banks.title')}</h1>
          <div className="truncate text-sm text-muted-foreground">
            {bank?.bank_name ?? '—'} · {bank?.account_number ?? '—'} · {(bank?.currency_code ?? baseCurrency) || 'MZN'}
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

      {/* Bank master data */}
      <Card>
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
      </Card>

      {/* Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
        <CardHeader><CardTitle>{t('bank.bookBalance')}</CardTitle></CardHeader>
          <CardContent className="text-2xl">{formatMoneyBase(bookBalance, baseCurrency)}</CardContent>
        </Card>
        <Card>
        <CardHeader><CardTitle>{t('bank.statementBalance')}</CardTitle></CardHeader>
          <CardContent className="text-2xl">
            {formatMoneyBase(
              statements.find(s => s.reconciled)?.closing_balance_base ??
              statements[0]?.closing_balance_base ?? 0,
              baseCurrency,
            )}
          </CardContent>
        </Card>
        <Card>
        <CardHeader><CardTitle>{t('bank.difference')}</CardTitle></CardHeader>
          <CardContent className="text-2xl">{formatMoneyBase(diff, baseCurrency)}</CardContent>
        </Card>
      </div>

      {/* Transactions */}
      <Card className="overflow-hidden">
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
                <Label>{t('bank.amount', { code: currency })}</Label>
                <Input inputMode="decimal" value={txAmt} onChange={e => setTxAmt(e.target.value)} placeholder={tf('bank.placeholder.amount', '-120.00')} />
              </div>
              <Button className="w-full sm:w-auto" onClick={addTx} disabled={!canManageSettlement || addingTx}>{addingTx ? t('actions.saving') : t('cash.add')}</Button>
            </div>

            {/* CSV import */}
            <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="min-w-0">
                <Label className="block">{t('bank.csv.fileLabel')}</Label>
                <Input type="file" accept=".csv" onChange={e => setCsvFile(e.target.files?.[0] ?? null)} />
              </div>
              <Button className="w-full sm:w-auto" onClick={importCsv} disabled={!canManageSettlement || importing || !csvFile}>
                {importing ? t('bank.csv.importing') : t('bank.csv.import')}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          {!canManageSettlement ? (
            <div className="mb-4 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              {tf('bank.financeAuthorityNotice', 'Only finance-authority users can post bank ledger transactions or import statement rows.')}
            </div>
          ) : null}
          {/* Guidance */}
          <div className="mb-2 hidden text-xs text-muted-foreground sm:block">{t('bank.csv.header')}</div>
          <table className="mb-4 hidden w-full rounded border text-xs sm:table">
            <thead className="bg-muted/30 text-left">
              <tr>
                <th className="py-2 px-3">{t('table.date')} (DD/MM/YYYY)</th>
                <th className="py-2 px-3">{t('bank.memo')}</th>
                <th className="py-2 px-3 text-right">{t('bank.amount', { code: currency })}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="py-2 px-3">{t('bank.csv.placeholderDate')}</td>
                <td className="py-2 px-3">{t('bank.csv.placeholderOpen')}</td>
                <td className="py-2 px-3 text-right">{t('bank.csv.placeholderAmount')}</td>
              </tr>
            </tbody>
          </table>
          <div className="text-xs text-muted-foreground mb-4"></div>

          {/* List */}
          <table className="w-full text-sm">
            <thead className="text-left sticky top-0 bg-background">
              <tr>
                <th className="py-2 pr-3">{t('table.date')}</th>
                <th className="py-2 pr-3">{t('table.ref')}</th>
                <th className="py-2 pr-3">{t('bank.memo')}</th>
                <th className="py-2 pr-3 text-right">{t('bank.amount', { code: currency })}</th>
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
                        {formatOrderReference(r.ref_type, r.ref_id, orderRefByKey, t('common.dash'))}
                      </Link>
                    ) : (
                      formatOrderReference(r.ref_type, r.ref_id, orderRefByKey, t('common.dash'))
                    )}
                  </td>
                  <td className="py-2 pr-3">{r.memo ?? t('common.dash')}</td>
                  <td className="py-2 pr-3 text-right">{formatMoneyBase(r.amount_base, baseCurrency)}</td>
                  <td className="py-2 pl-3 text-right">
                    <Button
                      variant={r.reconciled ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() => toggleReconciled(r.id, !r.reconciled)}
                      disabled={savingTx === r.id}
                    >
                      {r.reconciled ? t('bank.reconciled') : t('bank.markReconciled')}
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td className="py-6 text-muted-foreground" colSpan={5}>{t('bank.noTx')}</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Statements */}
      <Card>
        <CardHeader><CardTitle>{t('bank.statements')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-4 gap-3 items-end">
            <div>
              <Label>{t('bank.statementDate')}</Label>
              <Input type="date" value={stDate} onChange={e => setStDate(e.target.value)} />
            </div>
            <div>
              <Label>{t('bank.closing', { code: currency })}</Label>
              <Input inputMode="decimal" value={stClosing} onChange={e => setStClosing(e.target.value)} />
            </div>
            <div>
              <Label>{t('bank.file')}</Label>
              <Input type="file" onChange={e => setStFile(e.target.files?.[0] ?? null)} />
            </div>
            <div>
              <Button onClick={uploadStatement} disabled={uploading}>
                {uploading ? t('bank.uploading') : t('bank.saveStatement')}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr>
                  <th className="py-2 pr-3">{t('table.date')}</th>
                  <th className="py-2 pr-3 text-right">{t('bank.closing', { code: currency })}</th>
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
                          variant={s.reconciled ? 'secondary' : 'outline'}
                          size="sm"
                          onClick={async () => {
                            const { error } = await supabase.from('bank_statements')
                              .update({ reconciled: !s.reconciled }).eq('id', s.id).eq('bank_id', scopedBankId)
                            if (error) { toast.error(t('bank.toast.toggleFailed')); return }
                            setStatements(prev => prev.map(x => x.id === s.id ? { ...x, reconciled: !x.reconciled } : x))
                            await loadBookBalance()
                          }}
                        >
                          {s.reconciled ? t('bank.reconciled') : t('bank.notReconciled')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={s.reconciled}
                          onClick={() => deleteStatement(s)}
                        >
                          {t('bank.delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {statements.length === 0 && (
                  <tr><td className="py-6 text-muted-foreground" colSpan={4}>{t('bank.noStatements')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
