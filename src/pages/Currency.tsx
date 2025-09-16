// src/pages/Currency.tsx
import { useEffect, useState } from 'react'
import { db, supabase } from '../lib/db'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { setBaseCurrencyCode } from '../lib/currency'
import toast from 'react-hot-toast'

type Currency = { code: string; name: string; symbol?: string | null; decimals?: number | null }
type FxRate = { id: string; date: string; fromCode: string; toCode: string; rate: number }

// Global reference defaults (we seed the reference table if missing)
const DEFAULT_CURRENCIES: Currency[] = [
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT', decimals: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimals: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2 },
]

export default function CurrencyPage() {
  const [currencies, setCurrencies] = useState<Currency[]>([])          // list shown in dropdowns (company-allowed)
  const [base, setBase] = useState<string>('MZN')                       // company base currency (from view)
  const [fx, setFx] = useState<FxRate[]>([])                            // recent FX rows

  // new fx form
  const [fxDate, setFxDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState<string>('USD')
  const [to, setTo] = useState<string>('MZN')
  const [rate, setRate] = useState<string>('')

  useEffect(() => {
    (async () => {
      try {
        // 1) Load global reference currencies (for seeding only), and recent fx
        const [csRef, fxRates] = await Promise.all([
          db.currencies.list({ orderBy: { code: 'asc' } }).catch(() => [] as Currency[]),
          db.fxRates.list({ orderBy: { date: 'desc' }, limit: 200 }).catch(() => [] as FxRate[]),
        ])

        // 2) Ensure global reference defaults exist (idempotent; safe to re-run)
        const need = DEFAULT_CURRENCIES.filter(d => !(csRef || []).find(c => c.code === d.code))
        if (need.length) {
          const { error } = await supabase.from('currencies').upsert(need)
          if (error) throw error
        }

        // 3) Load company-scoped: base and allowed currencies
        const [{ data: baseRow, error: baseErr }, { data: allowed, error: allowErr }] = await Promise.all([
          supabase.from('company_settings_view').select('base_currency_code').limit(1).maybeSingle(),
          supabase.from('company_currencies_view').select('code,name,symbol,decimals').order('code', { ascending: true }),
        ])
        if (baseErr) throw baseErr
        if (allowErr) throw allowErr

        // 4) Apply company base (fallback to MZN if not set)
        if (baseRow?.base_currency_code) setBase(baseRow.base_currency_code)

        // 5) Choose the list for dropdowns:
        //    Prefer company-allowed; if empty (unlikely after seeding), fall back to global reference list.
        const list = (allowed && allowed.length ? allowed : (csRef || [])) as Currency[]
        setCurrencies(list)

        // 6) FX table
        setFx(fxRates || [])

        // 7) Make sure selectors have valid codes (constrained by "list")
        if (list.length) {
          if (!list.find(c => c.code === from)) setFrom(list[0].code)
          if (!list.find(c => c.code === to)) setTo(list[0].code)
          if (!list.find(c => c.code === base)) setBase(list[0].code)
        }
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to load currency data')
      }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Company-scoped save: writes ONLY to your company via RPC with RLS
  async function saveBase() {
    try {
      const { error } = await supabase.rpc('set_base_currency_for_current_company', { p_code: base })
      if (error) throw error
      setBaseCurrencyCode(base) // keep local cache for client helpers
      toast.success('Base currency saved')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save base currency')
    }
  }

  async function addFx() {
    try {
      const r = parseFloat(rate)
      if (!fxDate || !from || !to || !r || Number.isNaN(r) || r <= 0) {
        toast.error('Please fill date, from, to and a positive rate')
        return
      }
      const id = `fx_${fxDate}_${from}_${to}`

      // IMPORTANT: use snake_case fields; do NOT send fromCode/toCode (they’re generated)
      const payload = {
        id,
        date: fxDate,
        from_code: from,
        to_code: to,
        rate: r,
      }

      const { error } = await supabase.from('fx_rates').upsert(payload)
      if (error) throw error

      toast.success('FX rate saved')

      const updated = await db.fxRates.list({ orderBy: { date: 'desc' }, limit: 200 })
      setFx(updated || [])
      setRate('')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save FX rate')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Currency & FX</h1>

      <Card>
        <CardHeader><CardTitle>Base Currency</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="w-64">
            <Label>Base Currency</Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {currencies.map(c => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={saveBase}>Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Add / Update FX Rate</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <div>
            <Label>Date</Label>
            <Input type="date" value={fxDate} onChange={e => setFxDate(e.target.value)} />
          </div>
          <div>
            <Label>From</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {currencies.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>To</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {currencies.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Rate (1 From = ? To)</Label>
            <Input
              type="number"
              min="0"
              step="0.000001"
              value={rate}
              onChange={e => setRate(e.target.value)}
              placeholder="e.g., 63.50"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={addFx}>Save Rate</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent Rates</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 pr-2">Pair</th>
                <th className="py-2 pr-2">Rate</th>
              </tr>
            </thead>
            <tbody>
              {fx.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-muted-foreground">No rates saved.</td>
                </tr>
              )}
              {fx.map(r => (
                <tr key={r.id} className="border-b">
                  <td className="py-2 pr-2">{r.date}</td>
                  <td className="py-2 pr-2">{r.fromCode} → {r.toCode}</td>
                  <td className="py-2 pr-2">{r.rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
