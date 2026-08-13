// src/pages/Currency.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { can, type CompanyRole } from '../lib/permissions'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  FxConversionPreview,
  FxRateSavedResult,
  type SavedFxRate,
} from '../components/currency/FxConversionPreview'
import toast from 'react-hot-toast'
import { setBaseCurrencyCode } from '../lib/currency'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { PremiumMetricCard } from '../components/premium/PremiumMetricCard'
import { PremiumPageHeader } from '../components/premium/PremiumPageHeader'
import { PremiumStatusBadge } from '../components/premium/PremiumStatusBadge'

type Currency = { code: string; name: string; symbol?: string | null; decimals?: number | null }
type FxRate = {
  id: string
  date: string
  from_code: string
  to_code: string
  rate: number
  fromCode?: string
  toCode?: string
}

const DEFAULT_CURRENCIES: Currency[] = [
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT', decimals: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimals: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2 },
]

export default function CurrencyPage() {
  const { companyId, companyName, myRole, authorityMode } = useOrg()
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const role: CompanyRole = (myRole as CompanyRole) ?? 'VIEWER'
  const canEdit = can.updateMaster(role)

  const [loading, setLoading] = useState(true)
  const [allCurrencies, setAllCurrencies] = useState<Currency[]>([])
  const [allowed, setAllowed] = useState<Currency[]>([])
  const [base, setBase] = useState<string>('MZN')

  const [fx, setFx] = useState<FxRate[]>([])
  const [fxDate, setFxDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState<string>('USD')
  const [to, setTo] = useState<string>('MZN')
  const [rate, setRate] = useState<string>('')
  const [savedFxRate, setSavedFxRate] = useState<SavedFxRate | null>(null)

  const allowedCodes = useMemo(() => new Set(allowed.map(a => a.code)), [allowed])
  const availableCurrencies = useMemo(
    () =>
      [...allCurrencies].sort((left, right) => {
        const leftEnabled = allowedCodes.has(left.code) ? 0 : 1
        const rightEnabled = allowedCodes.has(right.code) ? 0 : 1
        if (leftEnabled !== rightEnabled) return leftEnabled - rightEnabled
        return left.code.localeCompare(right.code)
      }),
    [allCurrencies, allowedCodes]
  )

  // -------- Load (per-company) --------
  useEffect(() => {
    setSavedFxRate(null)
    if (!companyId) {
      setAllCurrencies([])
      setAllowed([])
      setFx([])
      setBase('MZN')
      setLoading(false)
      return
    }

    ;(async () => {
      try {
        setLoading(true)

        // 1) Seed master currency codes (idempotent, global)
        await supabase.from('currencies').upsert(DEFAULT_CURRENCIES)

        const { data: all, error: allErr } = await supabase
          .from('currencies')
          .select('code,name,symbol,decimals')
          .order('code', { ascending: true })
        if (allErr) throw allErr
        setAllCurrencies((all || []) as Currency[])

        // 2) Allowed currencies – company scoped via view/RLS
        const { data: ac, error: acErr } = authorityMode === 'platform_workspace'
          ? await supabase
              .from('company_currencies')
              .select('currency_code')
              .eq('company_id', companyId)
              .order('currency_code', { ascending: true })
          : await supabase
              .from('company_currencies_view')
              .select('code,name,symbol,decimals')
              .order('code', { ascending: true })
        if (acErr) throw acErr

        let allowedList = authorityMode === 'platform_workspace'
          ? ((ac || []) as Array<{ currency_code: string }>).flatMap((entry) => {
              const currency = ((all || []) as Currency[]).find((candidate) => candidate.code === entry.currency_code)
              return currency ? [currency] : []
            })
          : (ac || []) as Currency[]
        // first time: enable DEFAULT_CURRENCIES for this company
        if (!allowedList.length) {
          const ins = await supabase
            .from('company_currencies')
            .upsert(DEFAULT_CURRENCIES.map(c => ({ company_id: companyId, currency_code: c.code })))
          if (ins.error) throw ins.error

          const { data: seeded, error: seededErr } = authorityMode === 'platform_workspace'
            ? await supabase
                .from('company_currencies')
                .select('currency_code')
                .eq('company_id', companyId)
                .order('currency_code', { ascending: true })
            : await supabase
                .from('company_currencies_view')
                .select('code,name,symbol,decimals')
                .order('code', { ascending: true })
          if (seededErr) throw seededErr
          allowedList = authorityMode === 'platform_workspace'
            ? ((seeded || []) as Array<{ currency_code: string }>).flatMap((entry) => {
                const currency = ((all || []) as Currency[]).find((candidate) => candidate.code === entry.currency_code)
                return currency ? [currency] : []
              })
            : (seeded || []) as Currency[]
        }
        setAllowed(allowedList)

        // 3) Base currency – company scoped
        const { data: s, error: sErr } = authorityMode === 'platform_workspace'
          ? await supabase
              .from('company_settings')
              .select('base_currency_code')
              .eq('company_id', companyId)
              .maybeSingle()
          : await supabase
              .from('company_settings_view')
              .select('base_currency_code')
              .limit(1)
              .maybeSingle()
        if (sErr) throw sErr
        const currentBase = s?.base_currency_code || 'MZN'
        setBase(currentBase)
        setBaseCurrencyCode(currentBase, companyId)

        // 4) FX rates – company scoped
        const { data: fxRows, error: fxErr } = authorityMode === 'platform_workspace'
          ? await supabase
              .from('fx_rates')
              .select('id,date,from_code,to_code,rate')
              .eq('company_id', companyId)
              .order('date', { ascending: false })
              .limit(200)
          : await supabase
              .from('fx_rates_view')
              .select('id,date,from_code,to_code,rate,fromCode,toCode')
              .order('date', { ascending: false })
              .limit(200)
        if (fxErr) throw fxErr
        setFx((fxRows || []) as FxRate[])

        // keep selectors valid after company switch
        const allowedArr = Array.from(new Set(allowedList.map(c => c.code)))
        const fallback = allowedArr.includes('MZN') ? 'MZN' : (allowedArr[0] || 'MZN')
        if (!allowedArr.includes(from)) setFrom(fallback)
        if (!allowedArr.includes(to)) setTo(fallback)
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || tt('currency.toast.loadFailed', 'Failed to load currency data'))
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  // -------- Actions (all scoped by RLS/trigger to current company) --------
  async function saveBase() {
    try {
      if (!canEdit) return toast.error(tt('currency.toast.noPermission', 'You do not have permission to change currency settings'))
      if (!allowedCodes.has(base)) return toast.error(tt('currency.toast.baseMustBeEnabled', 'Base currency must be enabled for this company'))
      const { error } = await supabase.rpc(
        authorityMode === 'platform_workspace'
          ? 'platform_admin_set_assisted_base_currency'
          : 'set_base_currency_for_current_company',
        authorityMode === 'platform_workspace'
          ? { p_company_id: companyId, p_code: base }
          : { p_code: base },
      )
      if (error) throw error
      setBaseCurrencyCode(base, companyId)
      toast.success(tt('currency.toast.baseSaved', 'Base currency saved for this company'))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('currency.toast.baseSaveFailed', 'Failed to save base currency'))
    }
  }

  async function refreshAllowed() {
    const { data, error } = authorityMode === 'platform_workspace'
      ? await supabase
          .from('company_currencies')
          .select('currency_code')
          .eq('company_id', companyId)
          .order('currency_code', { ascending: true })
      : await supabase
          .from('company_currencies_view')
          .select('code,name,symbol,decimals')
          .order('code', { ascending: true })
    if (error) throw error
    if (authorityMode === 'platform_workspace') {
      const codes = new Set(((data || []) as Array<{ currency_code: string }>).map((entry) => entry.currency_code))
      setAllowed(allCurrencies.filter((currency) => codes.has(currency.code)))
    } else {
      setAllowed((data || []) as Currency[])
    }
  }

  async function addAllowed(code: string) {
    try {
      if (!canEdit) return toast.error(tt('currency.toast.noPermission', 'You do not have permission to change currency settings'))
      const { error } = await supabase.from('company_currencies').insert({ company_id: companyId, currency_code: code })
      if (error) throw error
      await refreshAllowed()
      toast.success(tt('currency.toast.enabled', 'Enabled {code} for this company', { code }))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('currency.toast.enableFailed', 'Failed to enable {code}', { code }))
    }
  }

  async function removeAllowed(code: string) {
    try {
      if (!canEdit) return toast.error(tt('currency.toast.noPermission', 'You do not have permission to change currency settings'))
      if (code === base) return toast.error(tt('currency.toast.cannotRemoveBase', 'You cannot remove the current base currency'))
      const { error } = await supabase.from('company_currencies').delete().eq('company_id', companyId).eq('currency_code', code)
      if (error) throw error
      await refreshAllowed()
      toast.success(tt('currency.toast.disabled', 'Disabled {code} for this company', { code }))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('currency.toast.disableFailed', 'Failed to disable {code}', { code }))
    }
  }

  async function addFx() {
    try {
      if (!canEdit) return toast.error(tt('currency.toast.noPermissionFx', 'You do not have permission to save FX rates'))
      const r = parseFloat(rate)
      if (!fxDate || !from || !to || !r || Number.isNaN(r) || r <= 0) {
        toast.error(tt('currency.toast.fillFxFields', 'Please fill date, from, to and a positive rate'))
        return
      }
      if (!allowedCodes.has(from) || !allowedCodes.has(to)) {
        toast.error(tt('currency.toast.enableBoth', 'Both currencies must be enabled for this company'))
        return
      }
      setSavedFxRate(null)
      const payload = { company_id: companyId, date: fxDate, from_code: from, to_code: to, rate: r }
      const { error } = await supabase
        .from('fx_rates')
        .upsert(payload, { onConflict: 'company_id,date,from_code,to_code' })
      if (error) throw error

      const { data, error: rErr } = authorityMode === 'platform_workspace'
        ? await supabase
            .from('fx_rates')
            .select('id,date,from_code,to_code,rate')
            .eq('company_id', companyId)
            .order('date', { ascending: false })
            .limit(200)
        : await supabase
            .from('fx_rates_view')
            .select('id,date,from_code,to_code,rate,fromCode,toCode')
            .order('date', { ascending: false })
            .limit(200)
      if (rErr) throw rErr
      setFx((data || []) as FxRate[])
      setSavedFxRate({ date: fxDate, from, to, rate: r })
      setRate('')
      toast.success(tt('currency.toast.rateSaved', 'FX rate saved'))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('currency.toast.rateSaveFailed', 'Failed to save FX rate'))
    }
  }

  if (loading) {
    return (
      <div className="app-page app-page--workspace">
        <PremiumPageHeader title={t('currency.title')} description={t('currency.subtitle')} />
        <Card><CardContent className="p-6"><div className="h-24 rounded bg-muted animate-pulse" /></CardContent></Card>
        <Card><CardContent className="p-6"><div className="h-24 rounded bg-muted animate-pulse" /></CardContent></Card>
        <Card><CardContent className="p-6"><div className="h-24 rounded bg-muted animate-pulse" /></CardContent></Card>
      </div>
    )
  }

  return (
    <div className="app-page app-page--workspace">
      <PremiumPageHeader
        title={t('currency.title')}
        description={tt(
          'currency.subtitle',
          'Control the currencies this company uses, set the base currency, and maintain FX rates.'
        )}
        context={companyId ? (
          <PremiumStatusBadge tone="neutral">
            {tt('users.company', 'Company')}: {companyName || tt('company.selectCompany', 'Company')}
          </PremiumStatusBadge>
        ) : undefined}
        status={!canEdit ? <PremiumStatusBadge tone="info">{tt('common.readOnly', 'Read-only')}</PremiumStatusBadge> : undefined}
      />

      {!canEdit ? (
        <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          {tt(
            'currency.readOnly',
            'Read-only: only operational roles can change enabled currencies, base currency, or FX rates.'
          )}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <PremiumMetricCard label={tt('currency.summary.base', 'Base currency')} value={base} description={tt('currency.summary.baseHelp', 'Used as the default valuation and reporting currency.')} />
        <PremiumMetricCard label={tt('currency.summary.enabled', 'Enabled currencies')} value={allowed.length} description={tt('currency.summary.enabledHelp', 'Currencies currently available to this company.')} />
        <PremiumMetricCard label={tt('currency.summary.fxRows', 'Recent FX rows')} value={fx.length} description={tt('currency.summary.fxRowsHelp', 'Saved rates visible in the current company scope.')} />
      </div>

      {/* Allowed per company */}
      <Card>
        <CardHeader><CardTitle className="text-lg">{t('currency.allowed')}</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          <div className="text-sm text-muted-foreground">
            {tt('currency.allowedHelp', 'Keep enabled codes aligned with the currencies you actually buy, sell, and settle in.')}
          </div>

          <div className="flex min-w-0 flex-wrap gap-2">
            {availableCurrencies.map(c => {
              const on = allowedCodes.has(c.code)
              return (
                <div
                  key={c.code}
                  className={[
                    'flex min-w-0 max-w-full flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-foreground',
                    on
                      ? ''
                      : 'bg-muted/30'
                  ].join(' ')}
                >
                  <div className="min-w-[4.25rem] font-mono text-sm">{c.code}</div>
                  <div className="min-w-0 flex-1 truncate text-sm">{c.name}</div>
                  {on ? (
                    <>
                      <PremiumStatusBadge tone="positive">{tt('currency.enabledStatus', 'Enabled')}</PremiumStatusBadge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-9 w-full sm:w-auto"
                        onClick={() => removeAllowed(c.code)}
                        disabled={!canEdit}
                      >
                        {tt('currency.disable', 'Disable')}
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" className="w-full sm:w-auto" onClick={() => addAllowed(c.code)} disabled={!canEdit}>
                      {t('suppliers.enable')}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Base currency */}
      <Card>
        <CardHeader><CardTitle>{t('currency.base')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:w-72">
            <Label>{t('currency.baseLabel')}</Label>
            <Select value={base} onValueChange={setBase} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowed.map(c => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} - {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full sm:w-auto" onClick={saveBase} disabled={!canEdit}>{t('currency.save')}</Button>
        </CardContent>
      </Card>

      {/* FX */}
      <Card>
        <CardHeader><CardTitle>{t('currency.addFx')}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div>
            <Label>{t('currency.date')}</Label>
            <Input type="date" value={fxDate} onChange={e => setFxDate(e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <Label>{t('currency.from')}</Label>
            <Select value={from} onValueChange={setFrom} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowed.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('currency.to')}</Label>
            <Select value={to} onValueChange={setTo} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowed.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('currency.rate')}</Label>
            <Input
              type="number"
              min="0"
              step="0.000001"
              value={rate}
              onChange={e => setRate(e.target.value)}
              placeholder={tt('currency.placeholder.rate', 'e.g., 63.50')}
              disabled={!canEdit}
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={addFx} disabled={!canEdit}>{t('currency.saveRate')}</Button>
          </div>
        </CardContent>
      </Card>

      {savedFxRate ? <FxRateSavedResult result={savedFxRate} /> : null}

      <FxConversionPreview
        key={companyId || 'no-company'}
        date={fxDate}
        from={from}
        to={to}
        rate={rate}
        currencies={allowed}
      />

      {/* Recent rates */}
      <Card>
        <CardHeader><CardTitle>{t('currency.recentRates')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">{t('table.date')}</th>
                <th className="py-2 pr-2">{t('currency.pair')}</th>
                <th className="py-2 pr-2">{t('currency.rate')}</th>
              </tr>
            </thead>
            <tbody>
              {fx.length === 0 && (
                <tr><td colSpan={3} className="py-4 text-muted-foreground">{t('currency.noRates')}</td></tr>
              )}
              {fx.map(r => (
                <tr key={r.id} className="border-b">
                  <td className="py-2 pr-2">{r.date}</td>
                  <td className="py-2 pr-2">{(r.fromCode || r.from_code)} {'->'} {(r.toCode || r.to_code)}</td>
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
