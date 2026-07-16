import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { CircleDollarSign, Info, Plus, Save, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useI18n, withI18nFallback } from '../../lib/i18n'
import {
  commercialTaxErrorCode,
  commercialTaxOptionLabel,
  loadCommercialTaxConfiguration,
  type CommercialTaxConfiguration,
  type CommercialTaxTreatment,
} from '../../lib/commercialTax'
import { Badge } from '../ui/badge'
import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { RadioGroup, RadioGroupItem } from '../ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'

type Props = {
  companyId: string | null
  canEdit: boolean
}

const NO_DEFAULT = '__none__'
const UNCONFIGURED_POS_MODE = '__unconfigured__'

export function CommercialTaxSettings({ companyId, canEdit }: Props) {
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const taxErrorMessage = (error: unknown, key: string, fallback: string) =>
    commercialTaxErrorCode(error) ? tt(key, fallback) : ((error as any)?.message || tt(key, fallback))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [configuration, setConfiguration] = useState<CommercialTaxConfiguration | null>(null)
  const [salesDefaultId, setSalesDefaultId] = useState(NO_DEFAULT)
  const [purchaseDefaultId, setPurchaseDefaultId] = useState(NO_DEFAULT)
  const [posMode, setPosMode] = useState<'configured' | 'non_fiscal' | typeof UNCONFIGURED_POS_MODE>(UNCONFIGURED_POS_MODE)
  const [posExemptionReason, setPosExemptionReason] = useState('')
  const [nonFiscalAcknowledged, setNonFiscalAcknowledged] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [treatment, setTreatment] = useState<CommercialTaxTreatment>('standard')
  const [rate, setRate] = useState('')
  const [requiresReason, setRequiresReason] = useState(false)
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [effectiveUntil, setEffectiveUntil] = useState('')

  const refresh = useCallback(async () => {
    if (!companyId) {
      setConfiguration(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const next = await loadCommercialTaxConfiguration(companyId)
      setConfiguration(next)
      setSalesDefaultId(next.settings?.default_sales_tax_option_id || NO_DEFAULT)
      setPurchaseDefaultId(next.settings?.default_purchase_tax_option_id || NO_DEFAULT)
      setPosMode(next.settings?.pos_sales_tax_mode || UNCONFIGURED_POS_MODE)
      setPosExemptionReason(next.settings?.pos_sales_exemption_reason_text || '')
      setNonFiscalAcknowledged(false)
    } catch (error: any) {
      console.error(error)
      toast.error(taxErrorMessage(error, 'commercialTax.errors.load', 'Tax configuration could not be loaded'))
    } finally {
      setLoading(false)
    }
  }, [companyId, t])

  useEffect(() => { void refresh() }, [refresh])

  const activeOptions = configuration?.activeOptions || []
  const auditCount = useMemo(() => configuration?.options.length || 0, [configuration?.options.length])
  const selectedSalesDefault = useMemo(
    () => activeOptions.find((option) => option.id === salesDefaultId) || null,
    [activeOptions, salesDefaultId],
  )

  async function saveDefaults() {
    if (!companyId || !canEdit) return
    setSaving(true)
    try {
      const { error } = await supabase.rpc('set_company_tax_defaults', {
        p_company_id: companyId,
        p_default_sales_tax_option_id: salesDefaultId === NO_DEFAULT ? null : salesDefaultId,
        p_default_purchase_tax_option_id: purchaseDefaultId === NO_DEFAULT ? null : purchaseDefaultId,
      })
      if (error) throw error
      toast.success(tt('commercialTax.defaults.saved', 'Tax defaults saved'))
      await refresh()
    } catch (error: any) {
      console.error(error)
      toast.error(taxErrorMessage(error, 'commercialTax.errors.saveDefaults', 'Tax defaults could not be saved'))
    } finally {
      setSaving(false)
    }
  }

  async function createOption() {
    if (!companyId || !canEdit) return
    const numericRate = Number(rate)
    if (!code.trim() || !name.trim() || !Number.isFinite(numericRate) || numericRate < 0) {
      toast.error(tt('commercialTax.errors.optionRequired', 'Enter a code, name, and valid rate'))
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.rpc('upsert_company_tax_option', {
        p_company_id: companyId,
        p_code: code.trim(),
        p_display_name: name.trim(),
        p_treatment_type: treatment,
        p_rate: numericRate,
        p_requires_exemption_reason: treatment === 'standard' ? false : requiresReason,
        p_effective_from: effectiveFrom,
        p_effective_until: effectiveUntil || null,
        p_option_id: null,
      })
      if (error) throw error
      setCode('')
      setName('')
      setTreatment('standard')
      setRate('')
      setRequiresReason(false)
      setEffectiveUntil('')
      toast.success(tt('commercialTax.option.created', 'Tax option created'))
      await refresh()
    } catch (error: any) {
      console.error(error)
      toast.error(taxErrorMessage(error, 'commercialTax.errors.createOption', 'Tax option could not be created'))
    } finally {
      setSaving(false)
    }
  }

  async function savePosMode() {
    if (!companyId || !canEdit || posMode === UNCONFIGURED_POS_MODE) return
    if (posMode === 'non_fiscal' && !nonFiscalAcknowledged) {
      toast.error(tt('commercialTax.pos.ackRequired', 'Confirm that you understand the non-fiscal POS behavior before saving.'))
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.rpc('set_company_pos_tax_mode', {
        p_company_id: companyId,
        p_mode: posMode,
        p_default_exemption_reason_text: posMode === 'configured' ? posExemptionReason.trim() || null : null,
      })
      if (error) throw error
      toast.success(tt('commercialTax.pos.saved', 'Point of Sale tax handling saved'))
      await refresh()
    } catch (error: any) {
      console.error(error)
      const code = commercialTaxErrorCode(error)
      const messages: Record<string, string> = {
        commercial_tax_pos_default_unconfigured: tt('commercialTax.pos.errors.defaultUnconfigured', 'Configure an active default sales-tax option before using configured tax in Point of Sale.'),
        commercial_tax_pos_default_inactive: tt('commercialTax.pos.errors.defaultInactive', 'The default sales-tax option is not currently effective.'),
        commercial_tax_pos_exemption_reason_required: tt('commercialTax.pos.errors.reasonRequired', 'Enter the required exemption reason for the configured default option.'),
      }
      toast.error((code && messages[code]) || tt('commercialTax.pos.errors.save', 'Point of Sale tax handling could not be saved'))
    } finally {
      setSaving(false)
    }
  }

  async function toggleOption(optionId: string, isActive: boolean) {
    if (!companyId || !canEdit) return
    setSaving(true)
    try {
      const { error } = await supabase.rpc('set_company_tax_option_active', {
        p_company_id: companyId,
        p_option_id: optionId,
        p_is_active: isActive,
      })
      if (error) throw error
      toast.success(isActive
        ? tt('commercialTax.option.activated', 'Tax option activated')
        : tt('commercialTax.option.deactivated', 'Tax option deactivated'))
      await refresh()
    } catch (error: any) {
      console.error(error)
      toast.error(taxErrorMessage(error, 'commercialTax.errors.toggleOption', 'Tax option status could not be changed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <Card><CardContent className="h-40 animate-pulse bg-muted/20" /></Card>
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CircleDollarSign className="h-5 w-5" />
            {tt('commercialTax.title', 'Commercial tax configuration')}
          </CardTitle>
          <CardDescription>
            {tt('commercialTax.description', 'Configure the options operators may select on order lines. StockWise does not seed or infer legal rates.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{tt('commercialTax.defaults.sales', 'Default for Sales Orders')}</Label>
              <Select value={salesDefaultId} onValueChange={setSalesDefaultId} disabled={!canEdit || saving}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEFAULT}>{tt('commercialTax.notConfigured', 'Tax not configured')}</SelectItem>
                  {activeOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{commercialTaxOptionLabel(option)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tt('commercialTax.defaults.purchase', 'Default for Purchase Orders')}</Label>
              <Select value={purchaseDefaultId} onValueChange={setPurchaseDefaultId} disabled={!canEdit || saving}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEFAULT}>{tt('commercialTax.notConfigured', 'Tax not configured')}</SelectItem>
                  {activeOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{commercialTaxOptionLabel(option)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              {tt('commercialTax.defaults.help', 'No default leaves new lines visibly unconfigured and blocks confirmation or approval.')}
            </div>
            <Button onClick={saveDefaults} disabled={!canEdit || saving}>
              <Save className="mr-2 h-4 w-4" />
              {tt('commercialTax.defaults.save', 'Save defaults')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tt('commercialTax.pos.title', 'Point of Sale tax handling')}</CardTitle>
          <CardDescription>
            {tt('commercialTax.pos.description', 'Choose how future Point of Sale transactions apply tax. The choice is company-controlled and audited.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {posMode === UNCONFIGURED_POS_MODE ? (
            <Alert className="border-amber-500/40 bg-amber-500/8">
              <Info className="h-4 w-4" />
              <AlertTitle>{tt('commercialTax.pos.unconfiguredTitle', 'Point of Sale tax handling is not configured')}</AlertTitle>
              <AlertDescription>{tt('commercialTax.pos.unconfiguredAdmin', 'Configure Point of Sale tax handling before posting sales.')}</AlertDescription>
            </Alert>
          ) : null}

          <RadioGroup
            value={posMode}
            onValueChange={(value) => {
              setPosMode(value as 'configured' | 'non_fiscal')
              setNonFiscalAcknowledged(false)
            }}
            className="gap-3"
            disabled={!canEdit || saving}
          >
            <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
              <RadioGroupItem value="configured" className="mt-0.5" />
              <span className="min-w-0 space-y-1">
                <span className="block font-medium">{tt('commercialTax.pos.configured', 'Use configured sales tax')}</span>
                <span className="block text-sm font-normal text-muted-foreground">
                  {selectedSalesDefault
                    ? `${commercialTaxOptionLabel(selectedSalesDefault)} · ${tt(`commercialTax.treatment.${selectedSalesDefault.treatment_type}`, selectedSalesDefault.treatment_type)}`
                    : tt('commercialTax.pos.configuredMissing', 'No effective default sales-tax option is selected.')}
                </span>
              </span>
            </Label>
            <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
              <RadioGroupItem value="non_fiscal" className="mt-0.5" />
              <span className="min-w-0 space-y-1">
                <span className="block font-medium">{tt('commercialTax.pos.nonFiscal', 'Non-fiscal POS sales — tax not applied')}</span>
                <span className="block text-sm font-normal text-muted-foreground">
                  {tt('commercialTax.pos.nonFiscalHelp', 'Tax is not applied. Future POS sales record stock and payment activity and cannot be converted into fiscal invoices.')}
                </span>
              </span>
            </Label>
          </RadioGroup>

          {posMode === 'configured' && selectedSalesDefault?.requires_exemption_reason ? (
            <div className="space-y-2">
              <Label htmlFor="pos-sales-exemption-reason">{tt('commercialTax.pos.reason', 'Default POS exemption reason')}</Label>
              <Input
                id="pos-sales-exemption-reason"
                value={posExemptionReason}
                onChange={(event) => setPosExemptionReason(event.target.value)}
                disabled={!canEdit || saving}
              />
              <p className="text-xs text-muted-foreground">{tt('commercialTax.pos.reasonHelp', 'Required by the selected configured tax option and snapshotted on future POS orders.')}</p>
            </div>
          ) : null}

          {posMode === 'non_fiscal' ? (
            <div className="space-y-3 rounded-lg border border-amber-500/35 bg-amber-500/8 p-4">
              <p className="text-sm">{tt('commercialTax.pos.futureOnly', 'This affects future Point of Sale sales only. Prior transactions do not change.')}</p>
              <Label className="flex items-start gap-3 font-normal">
                <Checkbox
                  checked={nonFiscalAcknowledged}
                  onCheckedChange={(checked) => setNonFiscalAcknowledged(checked === true)}
                  disabled={!canEdit || saving}
                />
                <span>{tt('commercialTax.pos.acknowledgement', 'I understand that StockWise will treat future Point of Sale transactions as non-fiscal operational sales and will prevent their conversion into fiscal invoices.')}</span>
              </Label>
            </div>
          ) : null}

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>{tt('commercialTax.pos.disclaimer', 'This setting controls StockWise behavior and does not determine the company’s legal tax obligations.')}</AlertDescription>
          </Alert>

          <div className="flex justify-end">
            <Button
              onClick={savePosMode}
              disabled={!canEdit || saving || posMode === UNCONFIGURED_POS_MODE || (posMode === 'configured' && !selectedSalesDefault) || (posMode === 'non_fiscal' && !nonFiscalAcknowledged)}
            >
              <Save className="mr-2 h-4 w-4" />
              {tt('commercialTax.pos.save', 'Save Point of Sale tax handling')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tt('commercialTax.option.new', 'Add an allowed tax option')}</CardTitle>
          <CardDescription>{tt('commercialTax.option.newHelp', 'Use a company-approved code and rate. Changes are written to the immutable configuration audit history.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2"><Label>{tt('commercialTax.fields.code', 'Code')}</Label><Input value={code} onChange={(event) => setCode(event.target.value)} disabled={!canEdit || saving} /></div>
            <div className="space-y-2 sm:col-span-1 lg:col-span-2"><Label>{tt('commercialTax.fields.name', 'Display name')}</Label><Input value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit || saving} /></div>
            <div className="space-y-2">
              <Label>{tt('commercialTax.fields.treatment', 'Treatment')}</Label>
              <Select value={treatment} onValueChange={(value) => {
                const next = value as CommercialTaxTreatment
                setTreatment(next)
                if (next !== 'standard') setRate('0')
                if (next === 'standard') setRequiresReason(false)
              }} disabled={!canEdit || saving}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">{tt('commercialTax.treatment.standard', 'Standard')}</SelectItem>
                  <SelectItem value="zero">{tt('commercialTax.treatment.zero', 'Explicit zero')}</SelectItem>
                  <SelectItem value="exempt">{tt('commercialTax.treatment.exempt', 'Exempt')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>{tt('commercialTax.fields.rate', 'Rate %')}</Label><Input type="number" min="0" step="0.0001" value={rate} onChange={(event) => setRate(event.target.value)} disabled={!canEdit || saving || treatment !== 'standard'} /></div>
            <div className="space-y-2"><Label>{tt('commercialTax.fields.effectiveFrom', 'Effective from')}</Label><Input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} disabled={!canEdit || saving} /></div>
            <div className="space-y-2"><Label>{tt('commercialTax.fields.effectiveUntil', 'Effective until')}</Label><Input type="date" value={effectiveUntil} onChange={(event) => setEffectiveUntil(event.target.value)} disabled={!canEdit || saving} /></div>
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 sm:col-span-2 lg:col-span-1">
              <Label>{tt('commercialTax.fields.requiresReason', 'Requires exemption reason')}</Label>
              <Switch checked={requiresReason} onCheckedChange={setRequiresReason} disabled={!canEdit || saving || treatment === 'standard'} />
            </div>
          </div>
          <Button onClick={createOption} disabled={!canEdit || saving}>
            <Plus className="mr-2 h-4 w-4" />
            {tt('commercialTax.option.add', 'Add option')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tt('commercialTax.options.title', 'Configured options')}</CardTitle>
          <CardDescription>{tt('commercialTax.options.help', '{count} auditable options. Inactive options remain readable on historical documents.', { count: auditCount })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {(configuration?.options || []).map((option) => (
              <div key={option.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{option.display_name}</span>
                    <Badge variant="outline">{option.code}</Badge>
                    <Badge variant={option.is_active ? 'default' : 'secondary'}>
                      {option.is_active ? tt('common.active', 'Active') : tt('common.inactive', 'Inactive')}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {commercialTaxOptionLabel(option)} | {tt(`commercialTax.treatment.${option.treatment_type}`, option.treatment_type)}
                  </p>
                </div>
                <Button variant="outline" onClick={() => toggleOption(option.id, !option.is_active)} disabled={!canEdit || saving}>
                  {option.is_active ? tt('commercialTax.option.deactivate', 'Deactivate') : tt('commercialTax.option.activate', 'Activate')}
                </Button>
              </div>
            ))}
            {!configuration?.options.length && (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {tt('commercialTax.options.empty', 'No tax options are configured. New order lines will remain unconfigured, not zero-rated.')}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
