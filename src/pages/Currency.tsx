// src/pages/Currency.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/db'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import toast from 'react-hot-toast'
import { setBaseCurrencyCode } from '../lib/currency'

type Currency = { code: string; name: string; symbol?: string | null; decimals?: number | null }
type FxRate = { id: string; date: string; from_code: string; to_code: string; rate: number; fromCode?: string; toCode?: string }

const DEFAULT_CURRENCIES: Currency[] = [
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT', decimals: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimals: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2 },
]

export default function CurrencyPage() {
  const [allCurrencies, setAllCurrencies] = useState<Currency[]>([])
  const [allowed, setAllowed] = useState<Currency[]>([])
  const [base, setBase] = useState<string>('MZN')

  // FX UI (uses global table but restricts pickers to allowed codes)
  const [fx, setFx] = useState<FxRate[]>([])
  const [fxDate, setFxDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState<string>('USD')
  const [to, setTo] = useState<string>('MZN')
  const [rate, setRate] = useState<string>('')

  const allowedCodes = useMemo(() => new Set(allowed.map(a => a.code)), [allowed])

  useEffect(() => {
    (async () => {
      try {
        // 1) Ensure global reference list has basic currencies (global reference is OK)
        await supabase.from('currencies').upsert(DEFAULT_CURRENCIES)

        // 2) Load global reference list
        {
          const { data, error } = await supabase
            .from('currencies')
            .select('code,name,symbol,decimals')
            .order('code', { ascending: true })
          if (error) throw error
          setAllCurrencies((data || []) as Currency[])
        }

        // 3) Load per-company allowed list (scoped view)
        {
          const { data, error } = await supabase
            .from('company_currencies_view')
            .select('code,name,symbol,decimals')
            .order('code', { ascending: true })
          if (error) throw error
          const allowedList = (data || []) as Currency[]

          // Seed company allowed list if empty
          if (!allowedList.length) {
            const toInsert = DEFAULT_CURRENCIES.map(c => ({ currency_code: c.code }))
            const { error: insErr } = await supabase.from('company_currencies').upsert(toInsert)
            if (insErr) throw insErr

            const { data: seeded, error: rErr } = await supabase
              .from('company_currencies_view')
              .select('code,name,symbol,decimals')
              .order('code', { ascending: true })
            if (rErr) throw rErr
            setAllowed((seeded || []) as Currency[])
          } else {
            setAllowed(allowedList)
          }
        }

        // 4) Load per-company base currency
        {
          const { data, error } = await supabase
            .from('company_settings_view')
            .select('base_currency_code')
            .limit(1)
            .maybeSingle()
          if (error) throw error
          const currentBase = data?.base_currency_code || 'MZN'
          setBase(currentBase)
          // Keep the in-memory helper in sync for other pages that read it
          setBaseCurrencyCode(currentBase)
        }

        // 5) FX list (global table), just for display
        {
          const { data, error } = await supabase
            .from('fx_rates')
            .select('id,date,from_code,to_code,rate')
            .order('date', { ascending: false })
            .limit(200)
          if (error) throw error
          setFx((data || []) as FxRate[])
        }

        // 6) Make sure pickers are valid members of allowed codes
        {
          const allowedArr = Array.from(allowedCodes)
          const fallback = (allowedArr[0] || 'MZN')
          if (!allowedCodes.has(from)) setFrom(allowedCodes.size ? fallback : 'MZN')
          if (!allowedCodes.has(to)) setTo(allowedCodes.size ? fallback : 'MZN')
        }
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to load currency data')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once

  async function saveBase() {
    try {
      if (!allowedCodes.has(base)) {
        toast.error('Base currency must be one of the company-allowed currencies')
        return
      }
      const { error } = await supabase.rpc('set_base_currency_for_current_company', { p_code: base })
      if (error) throw error
      setBaseCurrencyCode(base)
      toast.success('Base currency saved for this company')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save base currency')
    }
  }

  async function addAllowed(code: string) {
    try {
      // insert into table (RLS + default company_id will scope it correctly)
      const { error } = await supabase.from('company_currencies').insert({ currency_code: code })
      if (error) throw error
      const { data, error: rErr } = await supabase
        .from('company_currencies_view')
        .select('code,name,symbol,decimals')
        .order('code', { ascending: true })
      if (rErr) throw rErr
      setAllowed((data || []) as Currency[])
      // If base not in allowed anymore (edge case), set base to this newly added code for convenience
      if (!allowedCodes.has(base)) setBase(code)
      toast.success(`Enabled ${code} for this company`)
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || `Failed to enable ${code}`)
    }
  }

  async function removeAllowed(code: string) {
    try {
      // Cannot remove the current base
      if (code === base) {
        toast.error('You cannot remove the current base currency')
        return
      }
      const { error } = await supabase.from('company_currencies').delete().eq('currency_code', code)
      if (error) throw error
      const { data, error: rErr } = await supabase
        .from('company_currencies_view')
        .select('code,name,symbol,decimals')
        .order('code', { ascending: true })
      if (rErr) throw rErr
      setAllowed((data || []) as Currency[])
      toast.success(`Disabled ${code} for this company`)
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || `Failed to disable ${code}`)
    }
  }

  async function addFx() {
    try {
      const r = parseFloat(rate)
      if (!fxDate || !from || !to || !r || Number.isNaN(r) || r <= 0) {
        toast.error('Please fill date, from, to and a positive rate')
        return
      }
      if (!allowedCodes.has(from) || !allowedCodes.has(to)) {
        toast.error('Both currencies must be enabled for this company')
        return
      }
      const id = `fx_${fxDate}_${from}_${to}`
      const payload = { id, date: fxDate, from_code: from, to_code: to, rate: r }
      const { error } = await supabase.from('fx_rates').upsert(payload)
      if (error) throw error

      toast.success('FX rate saved')
      const { data, error: rErr } = await supabase
        .from('fx_rates')
        .select('id,date,from_code,to_code,rate')
        .order('date', { ascending: false })
        .limit(200)
      if (rErr) throw rErr
      setFx((data || []) as FxRate[])
      setRate('')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save FX rate')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Currency &amp; FX</h1>

      {/* Allowed currencies */}
      <Card>
        <CardHeader><CardTitle>Allowed Currencies (this company)</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          <div className="text-sm text-muted-foreground">
            Toggle which codes this company can use. Changes here don’t affect other companies.
          </div>
          <div className="flex flex-wrap gap-2">
            {allCurrencies.map(c => {
              const on = allowedCodes.has(c.code)
              return (
                <div key={c.code} className={`flex items-center gap-2 border rounded px-2 py-1 ${on ? 'bg-green-50' : ''}`}>
                  <div className="min-w-[5rem] font-mono">{c.code}</div>
                  <div className="text-sm">{c.name}</div>
                  {on ? (
                    <Button size="sm" variant="secondary" onClick={() => removeAllowed(c.code)}>Disable</Button>
                  ) : (
                    <Button size="sm" onClick={() => addAllowed(c.code)}>Enable</Button>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Base currency */}
      <Card>
        <CardHeader><CardTitle>Base Currency (this company)</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="w-64">
            <Label>Base Currency</Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowed.map(c => (
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

      {/* FX rates (global list; pickers restricted to allowed) */}
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
                {allowed.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>To</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowed.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Rate (1 From = ? To)</Label>
            <Input type="number" min="0" step="0.000001" value={rate} onChange={e => setRate(e.target.value)} placeholder="e.g., 63.50" />
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
                <tr><td colSpan={3} className="py-4 text-muted-foreground">No rates saved.</td></tr>
              )}
              {fx.map(r => (
                <tr key={r.id} className="border-b">
                  <td className="py-2 pr-2">{r.date}</td>
                  <td className="py-2 pr-2">{(r.fromCode || r.from_code)} → {(r.toCode || r.to_code)}</td>
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
