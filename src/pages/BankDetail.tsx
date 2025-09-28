// src/pages/BankDetail.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/db'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import toast from 'react-hot-toast'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { useOrg } from '../hooks/useOrg'
import { hasRole, CanManageUsers } from '../lib/roles'

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
// ---------------------------------------------------

export default function BankDetail() {
  const { bankId: bankIdA, id: bankIdB } = useParams()
  const bankId = bankIdA ?? bankIdB
  const { myRole } = useOrg()
  const canEditBank = hasRole(myRole, CanManageUsers)

  const [bank, setBank] = useState<Bank | null>(null)
  const [from, setFrom] = useState<string>(monthStartISO())
  const [to, setTo] = useState<string>(todayISO())
  const [rows, setRows] = useState<Tx[]>([])
  const [onlyUnreconciled, setOnlyUnreconciled] = useState<boolean>(false)
  const [statements, setStatements] = useState<Statement[]>([])
  const [bookBalance, setBookBalance] = useState<number>(0)
  const [savingTx, setSavingTx] = useState<string | null>(null)

  const [baseCurrency, setBaseCurrency] = useState<string>('MZN')

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
        const code = await getBaseCurrencyCode()
        if (mounted && code) setBaseCurrency(code)
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

  const currency = (bank?.currency_code ?? baseCurrency) || 'MZN'

  const diff = useMemo(() => {
    const stmt = statements.find(s => s.reconciled) || statements[0]
    const stBal = stmt?.closing_balance_base ?? 0
    return bookBalance - stBal
  }, [bookBalance, statements])

  useEffect(() => {
    if (!bankId) return
    loadBank()
  }, [bankId])

  useEffect(() => {
    if (!bankId) return
    loadTx()
    loadStatements()
    loadBookBalance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId, from, to])

  async function loadBank() {
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('id, company_id, name, bank_name, account_number, currency_code, tax_number, swift, nib')
      .eq('id', bankId).maybeSingle()
    if (error) { console.warn('bank_accounts not ready:', error.message); return }
    setBank(data as Bank)
  }

  async function saveBankDetails() {
    if (!bank || !canEditBank) return
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
      const { error } = await supabase.from('bank_accounts').update(payload).eq('id', bank.id)
      if (error) throw error
      toast.success('Bank details saved')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save bank details (DB not ready)')
    }
  }

  async function loadTx() {
    const myReq = ++latestTxReq.current
    const { data, error } = await supabase
      .from('bank_transactions')
      .select('id, bank_id, happened_at, memo, amount_base, reconciled, created_at')
      .eq('bank_id', bankId)
      .gte('happened_at', from)
      .lte('happened_at', to)
      .order('happened_at', { ascending: true })
      .order('created_at', { ascending: true })
    if (myReq !== latestTxReq.current) return
    if (error) { console.warn('bank_transactions not ready:', error.message); setRows([]); return }
    let list = (data as Tx[]) || []
    if (onlyUnreconciled) list = list.filter(r => !r.reconciled)
    setRows(list)
  }

  async function loadStatements() {
    const myReq = ++latestStmtReq.current
    const { data, error } = await supabase
      .from('bank_statements')
      .select('id, bank_id, statement_date, closing_balance_base, file_path, reconciled, created_at')
      .eq('bank_id', bankId)
      .order('statement_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (myReq !== latestStmtReq.current) return
    if (error) { console.warn('bank_statements not ready:', error.message); setStatements([]); return }
    setStatements(data as Statement[])
  }

  async function loadBookBalance() {
    const myReq = ++latestBalReq.current
    const { data, error } = await supabase.rpc('bank_book_balance', { p_bank: bankId })
    if (myReq !== latestBalReq.current) return
    if (error) { console.warn('bank_book_balance not ready:', error.message); setBookBalance(0); return }
    setBookBalance(typeof data === 'number' ? data : (data as any)?.balance ?? 0)
  }

  async function toggleReconciled(txId: string, value: boolean) {
    setSavingTx(txId)
    try {
      const { error } = await supabase
        .from('bank_transactions')
        .update({ reconciled: value })
        .eq('id', txId)
      if (error) throw error
      setRows(rs => rs.map(r => (r.id === txId ? { ...r, reconciled: value } : r)))
    } catch (e: any) {
      toast.error('Failed to update reconciliation')
      console.error(e)
    } finally {
      setSavingTx(null)
    }
  }

  // ----- Statements: upload, open (download), delete -----

  async function uploadStatement() {
    if (!bankId) return
    if (!stDate) { toast.error('Statement date is required'); return }
    const closing = Number(stClosing)
    if (Number.isNaN(closing)) { toast.error('Closing balance must be a number'); return }

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
          bank_id: bankId,
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
      toast.success('Statement saved')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Could not save statement')
    } finally {
      setUploading(false)
    }
  }

  async function openFile(key: string) {
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
      toast.error('Could not open file')
    }
  }

  async function deleteStatement(s: Statement) {
    if (s.reconciled) {
      toast.error('Reconciled statements cannot be deleted')
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
      const { error } = await supabase.from('bank_statements').delete().eq('id', s.id)
      if (error) throw error
      await loadBookBalance()
      await loadStatements()
      toast.success('Statement deleted')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Delete failed')
      await loadStatements()
    }
  }

  // ----- CSV import (DD/MM/YYYY) -----
  async function importCsv() {
    if (!bankId || !csvFile) { toast.error('Choose a CSV file first'); return }
    setImporting(true)
    try {
      const text = await csvFile.text()
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      if (lines.length === 0) { toast.error('Empty CSV'); return }

      const delim = detectDelimiter(lines[0])
      let start = 0
      const header = lines[0].toLowerCase()
      if (/(date|data)/.test(header) && /(amount|valor)/.test(header)) start = 1

      const payload: any[] = []
      for (let i = start; i < lines.length; i++) {
        const cols = splitCSVLine(lines[i], delim)
        const isoDate = normalizeDateDDMMYYYY(cols[0] ?? '')
        const amt = parseAmount(cols[2] ?? '')
        if (!isoDate || amt === null || amt === 0) continue
        payload.push({
          bank_id: bankId,
          happened_at: isoDate,
          memo: (cols[1] ?? '') || null,
          amount_base: amt,
          reconciled: false,
        })
      }
      if (!payload.length) { toast.error('No valid rows to import'); return }

      const { error } = await supabase.from('bank_transactions').insert(payload)
      if (error) throw error

      toast.success(`Imported ${payload.length} rows`)
      setCsvFile(null)
      await loadTx()
      await loadBookBalance()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  // Manual transaction add
  async function addTx() {
    if (!bankId) return
    const amt = Number(txAmt)
    if (Number.isNaN(amt) || amt === 0) { toast.error('Amount must be a non-zero number'); return }
    setAddingTx(true)
    try {
      const { error } = await supabase.from('bank_transactions').insert({
        bank_id: bankId,
        happened_at: txDate,
        memo: txMemo || null,
        amount_base: amt,
        reconciled: false,
      })
      if (error) throw error
      setTxMemo(''); setTxAmt('0'); setTxDate(todayISO())
      await loadTx()
      await loadBookBalance()
      toast.success('Transaction added')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to add transaction')
    } finally {
      setAddingTx(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{bank?.name ?? 'Bank'}</h1>
          <div className="text-sm text-muted-foreground">
            {bank?.bank_name ?? '—'} · {bank?.account_number ?? '—'} · {(bank?.currency_code ?? baseCurrency) || 'MZN'}
          </div>
        </div>
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 ml-2">
          <input
            id="unrec"
            type="checkbox"
            className="h-4 w-4"
            checked={onlyUnreconciled}
            onChange={e => { setOnlyUnreconciled(e.target.checked); loadTx() }}
          />
          <Label htmlFor="unrec">Unreconciled only</Label>
        </div>
      </div>

      {/* Bank master data */}
      <Card>
        <CardHeader><CardTitle>Bank Details</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-3">
          {/* NEW: Nickname */}
          <div>
            <Label>Nickname</Label>
            <Input
              value={bank?.name ?? ''}
              onChange={e => setBank(b => (b ? { ...b, name: e.target.value } : b))}
              disabled={!canEditBank}
              placeholder="e.g., Main MZN Account"
            />
          </div>

          <div>
            <Label>Bank name</Label>
            <Input
              value={bank?.bank_name ?? ''}
              onChange={e => setBank(b => (b ? { ...b, bank_name: e.target.value } : b))}
              disabled={!canEditBank}
              placeholder="e.g., Standard Bank"
            />
          </div>
          <div>
            <Label>Account number</Label>
            <Input
              value={bank?.account_number ?? ''}
              onChange={e => setBank(b => (b ? { ...b, account_number: e.target.value } : b))}
              disabled={!canEditBank}
              placeholder="########"
            />
          </div>
          <div>
            <Label>Currency code</Label>
            <Input
              value={bank?.currency_code ?? ''}
              onChange={e => setBank(b => (b ? { ...b, currency_code: e.target.value.toUpperCase() } : b))}
              disabled={!canEditBank}
              placeholder={baseCurrency || 'MZN'}
            />
          </div>
          <div>
            <Label>SWIFT</Label>
            <Input
              value={bank?.swift ?? ''}
              onChange={e => setBank(b => (b ? { ...b, swift: e.target.value.toUpperCase() } : b))}
              disabled={!canEditBank}
              placeholder="e.g., SBICMZMX"
            />
          </div>
          <div>
            <Label>NIB / BIN</Label>
            <Input
              value={bank?.nib ?? ''}
              onChange={e => setBank(b => (b ? { ...b, nib: e.target.value } : b))}
              disabled={!canEditBank}
              placeholder="e.g., 0003.0101.00014850100852"
            />
          </div>
          <div>
            <Label>Tax number (NUIT)</Label>
            <Input
              value={bank?.tax_number ?? ''}
              onChange={e => setBank(b => (b ? { ...b, tax_number: e.target.value } : b))}
              disabled={!canEditBank}
              placeholder="e.g., 400073414"
            />
          </div>

          <div className="md:col-span-3">
            <Button onClick={saveBankDetails} disabled={!canEditBank}>
              {canEditBank ? 'Save details' : 'View only (Manager+ to edit)'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader><CardTitle>Book balance</CardTitle></CardHeader>
          <CardContent className="text-2xl">{formatMoneyBase(bookBalance)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Statement balance</CardTitle></CardHeader>
          <CardContent className="text-2xl">
            {formatMoneyBase(
              statements.find(s => s.reconciled)?.closing_balance_base ??
              statements[0]?.closing_balance_base ?? 0
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Difference</CardTitle></CardHeader>
          <CardContent className="text-2xl">{formatMoneyBase(diff)}</CardContent>
        </Card>
      </div>

      {/* Transactions */}
      <Card className="overflow-hidden">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Transactions</CardTitle>
          <div className="flex flex-col md:flex-row gap-3 md:items-end">
            {/* Manual entry */}
            <div className="flex gap-2 items-end">
              <div>
                <Label>Date</Label>
                <Input type="date" value={txDate} onChange={e => setTxDate(e.target.value)} />
              </div>
              <div>
                <Label>Memo</Label>
                <Input value={txMemo} onChange={e => setTxMemo(e.target.value)} placeholder="e.g., Bank fee" />
              </div>
              <div>
                <Label>Amount ({currency})</Label>
                <Input inputMode="decimal" value={txAmt} onChange={e => setTxAmt(e.target.value)} placeholder="-120.00" />
              </div>
              <Button onClick={addTx} disabled={addingTx}>{addingTx ? 'Adding…' : 'Add'}</Button>
            </div>

            {/* CSV import */}
            <div className="flex items-end gap-2">
              <div>
                <Label className="block">CSV file</Label>
                <Input type="file" accept=".csv" onChange={e => setCsvFile(e.target.files?.[0] ?? null)} />
              </div>
              <Button onClick={importCsv} disabled={importing || !csvFile}>
                {importing ? 'Importing…' : 'Import CSV'}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          {/* Guidance */}
          <div className="text-xs text-muted-foreground mb-2">
            CSV columns (header optional) & manual entry use this format:
          </div>
          <table className="w-full text-xs mb-4 border rounded">
            <thead className="bg-muted/30 text-left">
              <tr>
                <th className="py-2 px-3">Date (DD/MM/YYYY)</th>
                <th className="py-2 px-3">Memo</th>
                <th className="py-2 px-3 text-right">Amount ({currency})</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t">
                <td className="py-2 px-3">05/01/2025</td>
                <td className="py-2 px-3">Opening balance</td>
                <td className="py-2 px-3 text-right">1,000.00</td>
              </tr>
            </tbody>
          </table>
          <div className="text-xs text-muted-foreground mb-4">
            Amount is in base currency. <strong>Inflows are positive</strong>, <strong>outflows are negative</strong>.
          </div>

          {/* List */}
          <table className="w-full text-sm">
            <thead className="text-left sticky top-0 bg-background">
              <tr>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Memo</th>
                <th className="py-2 pr-3 text-right">Amount ({currency})</th>
                <th className="py-2 pl-3 text-right">Reconciled</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-3">{r.happened_at}</td>
                  <td className="py-2 pr-3">{r.memo ?? '—'}</td>
                  <td className="py-2 pr-3 text-right">{formatMoneyBase(r.amount_base)}</td>
                  <td className="py-2 pl-3 text-right">
                    <Button
                      variant={r.reconciled ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() => toggleReconciled(r.id, !r.reconciled)}
                      disabled={savingTx === r.id}
                    >
                      {r.reconciled ? 'Reconciled' : 'Mark as reconciled'}
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td className="py-6 text-muted-foreground" colSpan={4}>No transactions in range.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Statements */}
      <Card>
        <CardHeader><CardTitle>Statements (audit archive)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-4 gap-3 items-end">
            <div>
              <Label>Statement date</Label>
              <Input type="date" value={stDate} onChange={e => setStDate(e.target.value)} />
            </div>
            <div>
              <Label>Closing balance ({currency})</Label>
              <Input inputMode="decimal" value={stClosing} onChange={e => setStClosing(e.target.value)} />
            </div>
            <div>
              <Label>File (PDF/CSV/Image)</Label>
              <Input type="file" onChange={e => setStFile(e.target.files?.[0] ?? null)} />
            </div>
            <div>
              <Button onClick={uploadStatement} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Save statement'}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3 text-right">Closing ({currency})</th>
                  <th className="py-2 pr-3">File</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {statements.map(s => (
                  <tr key={s.id} className="border-t">
                    <td className="py-2 pr-3">{s.statement_date}</td>
                    <td className="py-2 pr-3 text-right">{formatMoneyBase(s.closing_balance_base)}</td>
                    <td className="py-2 pr-3">
                      {s.file_path ? (
                        <Button variant="link" className="px-0" onClick={() => openFile(s.file_path!)}>View</Button>
                      ) : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant={s.reconciled ? 'secondary' : 'outline'}
                          size="sm"
                          onClick={async () => {
                            const { error } = await supabase.from('bank_statements')
                              .update({ reconciled: !s.reconciled }).eq('id', s.id)
                            if (error) { toast.error('Failed to toggle'); return }
                            setStatements(prev => prev.map(x => x.id === s.id ? { ...x, reconciled: !x.reconciled } : x))
                            await loadBookBalance()
                          }}
                        >
                          {s.reconciled ? 'Reconciled' : 'Not reconciled'}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={s.reconciled}
                          onClick={() => deleteStatement(s)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {statements.length === 0 && (
                  <tr><td className="py-6 text-muted-foreground" colSpan={4}>No statements uploaded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
