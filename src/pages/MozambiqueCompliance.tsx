import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Download, RefreshCw } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { useOrg } from '../hooks/useOrg'
import {
  exportFiscalDocumentWorkbook,
  type FiscalDocumentExportDocumentType,
  type FiscalDocumentExportFilters,
  type FiscalDocumentExportStatus,
} from '../lib/fiscalDocumentExport'
import { useI18n, withI18nFallback } from '../lib/i18n'
import {
  getCompanyFiscalSettings,
  listCompanyFiscalSeries,
  listFinanceEvents,
  listFiscalArtifacts,
  listSaftMozExports,
  type CompanyFiscalSettingsRow,
  type FinanceDocumentEventRow,
  type FinanceDocumentFiscalSeriesRow,
  type FiscalDocumentArtifactRow,
  type SaftMozExportRow,
} from '../lib/mzFinance'
import { can } from '../lib/permissions'
import { supabase } from '../lib/supabase'
import { AdministrationSectionNav } from '../components/administration/AdministrationSectionNav'
import { PremiumPageHeader } from '../components/premium/PremiumPageHeader'
import { PremiumStatusBadge } from '../components/premium/PremiumStatusBadge'
import {
  artifactBusinessName,
  complianceArtifactLabel,
  complianceEventLabel,
  complianceStatusLabel,
  fiscalDocumentTypeLabel,
} from '../lib/compliancePresentation'

type ComplianceView = 'readiness' | 'series' | 'export' | 'history'
const complianceViews: ComplianceView[] = ['readiness', 'series', 'export', 'history']

function exportTone(status: SaftMozExportRow['status']) {
  switch (status) {
    case 'submitted':
      return 'default'
    case 'failed':
      return 'destructive'
    default:
      return 'secondary'
  }
}

function shortDate(value?: string | null) {
  const text = String(value || '').trim()
  return text ? text.slice(0, 10) : '-'
}

export default function MozambiqueCompliancePage() {
  const { companyId, companyName, myRole } = useOrg()
  const { t, lang } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const activeView: ComplianceView = complianceViews.includes(requestedView as ComplianceView)
    ? requestedView as ComplianceView
    : 'readiness'
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)

  const [loading, setLoading] = useState(true)
  const [coreUnavailable, setCoreUnavailable] = useState(false)
  const [optionalUnavailable, setOptionalUnavailable] = useState<string[]>([])
  const [refreshToken, setRefreshToken] = useState(0)
  const [exportingFiscalDocuments, setExportingFiscalDocuments] = useState(false)
  const [exportFilters, setExportFilters] = useState<FiscalDocumentExportFilters>({
    documentType: 'all',
    status: 'all',
  })
  const [settings, setSettings] = useState<CompanyFiscalSettingsRow | null>(null)
  const [series, setSeries] = useState<FinanceDocumentFiscalSeriesRow[]>([])
  const [exports, setExports] = useState<SaftMozExportRow[]>([])
  const [events, setEvents] = useState<FinanceDocumentEventRow[]>([])
  const [artifacts, setArtifacts] = useState<FiscalDocumentArtifactRow[]>([])
  const [companyIdentity, setCompanyIdentity] = useState<{
    legal_name: string | null
    tax_id: string | null
    country_code: string | null
  } | null>(null)

  function reportRuntimeError(event: string, error: unknown, context: Record<string, unknown> = {}) {
    console.error(`[mz-runtime] MozambiqueCompliance.${event}`, {
      companyId,
      ...context,
      error,
    })
  }

  useEffect(() => {
    let active = true

    ;(async () => {
      if (!companyId) {
        setLoading(false)
        setSettings(null)
        setSeries([])
        setExports([])
        setEvents([])
        setArtifacts([])
        setCompanyIdentity(null)
        return
      }

      try {
        setLoading(true)
        setCoreUnavailable(false)
        setOptionalUnavailable([])
        const [identityResult, settingsResult, seriesResult, exportsResult, eventsResult, artifactsResult] = await Promise.allSettled([
          supabase
            .from('companies')
            .select('legal_name,tax_id,country_code')
            .eq('id', companyId)
            .single()
            .then(({ data, error }) => {
              if (error) throw error
              return data
            }),
          getCompanyFiscalSettings(companyId),
          listCompanyFiscalSeries(companyId),
          listSaftMozExports(companyId),
          listFinanceEvents(companyId),
          listFiscalArtifacts(companyId),
        ])

        if (!active) return
        if (identityResult.status === 'fulfilled') setCompanyIdentity(identityResult.value)
        else {
          setCompanyIdentity(null)
          setCoreUnavailable(true)
          reportRuntimeError('companyIdentity', identityResult.reason)
        }
        if (settingsResult.status === 'fulfilled') setSettings(settingsResult.value)
        else {
          setSettings(null)
          setCoreUnavailable(true)
          reportRuntimeError('fiscalSettings', settingsResult.reason)
        }
        if (seriesResult.status === 'fulfilled') setSeries(seriesResult.value)
        else {
          setSeries([])
          setCoreUnavailable(true)
          reportRuntimeError('fiscalSeries', seriesResult.reason)
        }

        const unavailable: string[] = []
        if (exportsResult.status === 'fulfilled') setExports(exportsResult.value)
        else { setExports([]); unavailable.push('exports'); reportRuntimeError('saftHistory', exportsResult.reason) }
        if (eventsResult.status === 'fulfilled') setEvents(eventsResult.value)
        else { setEvents([]); unavailable.push('events'); reportRuntimeError('auditHistory', eventsResult.reason) }
        if (artifactsResult.status === 'fulfilled') setArtifacts(artifactsResult.value)
        else { setArtifacts([]); unavailable.push('artifacts'); reportRuntimeError('artifactHistory', artifactsResult.reason) }
        setOptionalUnavailable(unavailable)
      } catch (error: any) {
        reportRuntimeError('loadWorkspace', error)
        if (active) toast.error(error?.message || tt('financeDocs.mz.complianceLoadFailed', 'Failed to load Mozambique compliance data'))
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [companyId, refreshToken])

  const activeSeries = series.filter((row) => row.is_active).sort((left, right) =>
    `${left.fiscal_year}-${left.document_type}`.localeCompare(`${right.fiscal_year}-${right.document_type}`),
  )
  const requiredSeries = new Set(activeSeries.map((row) => row.document_type))
  const supportedIssuanceReady = !coreUnavailable &&
    Boolean(companyIdentity?.legal_name && companyIdentity?.tax_id && companyIdentity?.country_code && settings) &&
    ['sales_invoice', 'sales_credit_note', 'sales_debit_note'].every((type) => requiredSeries.has(type as FinanceDocumentFiscalSeriesRow['document_type']))
  const unavailableLabel = tt('administration.statusUnavailable', 'Status unavailable')
  const complianceLanguage = lang === 'pt' ? 'pt' : 'en'
  const canExportFiscalDocuments = can.exportReports(myRole)

  function updateExportFilter<Key extends keyof FiscalDocumentExportFilters>(
    key: Key,
    value: FiscalDocumentExportFilters[Key],
  ) {
    setExportFilters((current) => ({ ...current, [key]: value }))
  }

  async function handleFiscalDocumentExport() {
    if (!companyId) return
    if (!canExportFiscalDocuments) {
      toast.error(tt('financeDocs.mz.fiscalExportDenied', 'You do not have permission to export fiscal documents.'))
      return
    }

    try {
      setExportingFiscalDocuments(true)
      const result = await exportFiscalDocumentWorkbook(companyId, exportFilters)
      if (!result.filename) {
        toast(tt('financeDocs.mz.fiscalExportEmpty', 'No fiscal documents match the selected filters.'))
        return
      }
      toast.success(
        tt('financeDocs.mz.fiscalExportReady', 'Fiscal export generated: {documents} documents, {lines} lines.', {
          documents: result.documentCount,
          lines: result.lineCount,
        }),
      )
    } catch (error: any) {
      reportRuntimeError('fiscalDocumentExport', error, { filters: exportFilters })
      toast.error(error?.message || tt('financeDocs.mz.fiscalExportFailed', 'Failed to generate fiscal document export.'))
    } finally {
      setExportingFiscalDocuments(false)
    }
  }

  return (
    <div className="space-y-6 overflow-x-hidden">
      <PremiumPageHeader
        title={tt('financeDocs.mz.complianceTitle', 'Mozambique compliance')}
        description={tt('financeDocs.mz.complianceSubtitle', 'Review supported issuance readiness, fiscal series, the fiscal review workbook, and optional evidence history.')}
        context={
          <PremiumStatusBadge tone={coreUnavailable ? 'warning' : supportedIssuanceReady ? 'positive' : 'warning'}>
            {coreUnavailable
              ? tt('administration.evidenceUnavailable', 'Evidence unavailable')
              : supportedIssuanceReady
                ? tt('financeDocs.mz.readySupportedIssuance', 'Ready for supported StockWise issuance')
                : tt('financeDocs.mz.needsConfiguration', 'Needs configuration')}
          </PremiumStatusBadge>
        }
        actions={
          <Button asChild variant="outline">
            <Link to="/settings?view=overview">{tt('setup.actions.return', 'Company setup')}</Link>
          </Button>
        }
      />

      <AdministrationSectionNav
        label={tt('financeDocs.mz.viewNavigation', 'Compliance views')}
        value={activeView}
        onChange={(view) => setSearchParams({ view })}
        sections={[
          { value: 'readiness', label: tt('financeDocs.mz.readinessView', 'Fiscal readiness') },
          { value: 'series', label: tt('financeDocs.mz.seriesView', 'Fiscal series') },
          { value: 'export', label: tt('financeDocs.mz.exportView', 'Review workbook') },
          { value: 'history', label: tt('financeDocs.mz.historyView', 'Optional history') },
        ]}
      />

      {coreUnavailable || optionalUnavailable.length > 0 ? (
        <div role="status" className="flex flex-col gap-3 rounded-[var(--radius)] border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">
              {coreUnavailable
                ? tt('setup.compliance.coreUnavailable', 'Fiscal setup evidence is temporarily unavailable.')
                : tt('setup.compliance.partialUnavailable', 'Some optional compliance history is temporarily unavailable.')}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {tt('setup.compliance.unavailableHelp', 'Unavailable evidence is not treated as missing setup. Retry the read before taking action.')}
            </p>
          </div>
          <Button type="button" variant="outline" disabled={loading} onClick={() => setRefreshToken((value) => value + 1)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {tt('setup.actions.retry', 'Retry')}
          </Button>
        </div>
      ) : null}

      {activeView === 'readiness' ? (
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle>{tt('financeDocs.mz.readinessTitle', 'Readiness for supported StockWise issuance')}</CardTitle>
            <CardDescription>
              {tt('financeDocs.mz.readinessHelp', 'Readiness uses live company identity, fiscal settings, and active fiscal-series evidence. It is not a universal legal-compliance score.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [tt('financeDocs.mz.legalIdentity', 'Legal identity'), companyIdentity?.legal_name],
              [tt('financeDocs.mz.nuit', 'NUIT'), companyIdentity?.tax_id],
              [tt('financeDocs.mz.jurisdiction', 'Jurisdiction'), companyIdentity?.country_code || settings?.jurisdiction_code],
              [tt('financeDocs.mz.languageCode', 'Document language'), settings?.document_language_code],
              [tt('financeDocs.mz.presentationCurrency', 'Presentation currency'), settings?.presentation_currency_code],
              [tt('financeDocs.mz.activeSeriesEvidence', 'Active fiscal series'), activeSeries.length ? String(activeSeries.length) : null],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border/70 bg-muted/15 p-4">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 font-medium">
                  {coreUnavailable
                    ? tt('administration.evidenceUnavailable', 'Evidence unavailable')
                    : value || tt('financeDocs.mz.needsConfiguration', 'Needs configuration')}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className={activeView === 'readiness' || activeView === 'series' ? 'grid gap-4 lg:grid-cols-2' : 'hidden'}>
        <Card className={activeView === 'readiness' ? 'border-border/80 shadow-sm' : 'hidden'}>
          <CardHeader>
            <CardTitle>{tt('financeDocs.mz.settingsTitle', 'Company fiscal settings')}</CardTitle>
            <CardDescription>{companyName || tt('setup.companyFallback', 'Active company')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
            ) : coreUnavailable ? (
              <p className="text-sm text-muted-foreground">{tt('setup.compliance.coreUnavailable', 'Fiscal setup evidence is temporarily unavailable.')}</p>
            ) : !settings ? (
              <p className="text-sm text-muted-foreground">{tt('financeDocs.mz.settingsMissing', 'No company fiscal settings are configured for the active company yet.')}</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.jurisdiction', 'Jurisdiction')}</div>
                  <div className="mt-1">{settings.jurisdiction_code}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.languageCode', 'Document language')}</div>
                  <div className="mt-1">{settings.document_language_code}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.presentationCurrency', 'Presentation currency')}</div>
                  <div className="mt-1">{settings.presentation_currency_code}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.retention', 'Retention')}</div>
                  <div className="mt-1">{settings.archive_retention_years} {tt('common.year', 'Year')}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.invoiceSeries', 'Invoice series')}</div>
                  <div className="mt-1">{settings.invoice_series_code}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.creditSeries', 'Credit note series')}</div>
                  <div className="mt-1">{settings.credit_note_series_code}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.debitSeries', 'Debit note series')}</div>
                  <div className="mt-1">{settings.debit_note_series_code}</div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.computerPhrase', 'Computer processed wording')}</div>
                  <div className="mt-1 font-medium uppercase tracking-[0.08em]">{settings.computer_processed_phrase_text}</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={activeView === 'series' ? 'border-border/80 shadow-sm lg:col-span-2' : 'hidden'}>
          <CardHeader>
            <CardTitle>{tt('financeDocs.mz.seriesTitle', 'Active fiscal series')}</CardTitle>
            <CardDescription className="hidden sm:block">{tt('financeDocs.mz.seriesHelp', 'These rows drive the next legal references for invoice, credit note, and debit note issuance.')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
            ) : coreUnavailable ? (
              <p className="text-sm text-muted-foreground">{tt('setup.compliance.coreUnavailable', 'Fiscal setup evidence is temporarily unavailable.')}</p>
            ) : activeSeries.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tt('financeDocs.mz.seriesEmpty', 'No active fiscal series are configured for the current company.')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tt('financeDocs.mz.documentType', 'Document type')}</TableHead>
                    <TableHead>{tt('financeDocs.mz.seriesCode', 'Series')}</TableHead>
                    <TableHead>{tt('common.year', 'Year')}</TableHead>
                    <TableHead>{tt('financeDocs.mz.activeState', 'Active state')}</TableHead>
                    <TableHead className="text-right">{tt('financeDocs.mz.nextNumber', 'Next number')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeSeries.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{fiscalDocumentTypeLabel(row.document_type, complianceLanguage, unavailableLabel)}</TableCell>
                      <TableCell>{row.series_code}</TableCell>
                      <TableCell>{row.fiscal_year}</TableCell>
                      <TableCell><Badge variant="secondary">{tt('common.active', 'Active')}</Badge></TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{row.next_number}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={activeView === 'export' ? 'border-border/80 shadow-sm' : 'hidden'}>
        <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>{tt('financeDocs.mz.reviewWorkbookTitle', 'Fiscal Document Review Workbook')}</CardTitle>
            <CardDescription className="mt-2 max-w-4xl leading-6">
              {tt(
                'financeDocs.mz.fiscalExportHelp',
                'Este livro organiza os dados fiscais e comerciais registados no StockWise para revisão e apoio à conformidade.',
              )}
            </CardDescription>
            <CardDescription className="mt-2 max-w-4xl leading-6">
              {tt(
                'financeDocs.mz.fiscalExportHelpEn',
                'This workbook organises fiscal and commercial data recorded in StockWise for review and compliance support.',
              )}
            </CardDescription>
            <CardDescription className="mt-2 max-w-4xl font-medium leading-6 text-foreground">
              {tt(
                'financeDocs.mz.workbookNonClaim',
                'It is not an official SAF-T/XML submission file, tax return, proof of submission, or Tax Authority acceptance.',
              )}
            </CardDescription>
          </div>
          <Badge variant="outline" className="w-fit shrink-0 rounded-full">
            XLSX
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="space-y-2">
              <Label>{tt('financeDocs.mz.dateFrom', 'Date from')}</Label>
              <Input
                type="date"
                value={exportFilters.dateFrom || ''}
                onChange={(event) => updateExportFilter('dateFrom', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{tt('financeDocs.mz.dateTo', 'Date to')}</Label>
              <Input
                type="date"
                value={exportFilters.dateTo || ''}
                onChange={(event) => updateExportFilter('dateTo', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{tt('financeDocs.mz.documentType', 'Document type')}</Label>
              <Select
                value={exportFilters.documentType || 'all'}
                onValueChange={(value) => updateExportFilter('documentType', value as FiscalDocumentExportDocumentType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tt('common.all', 'All')}</SelectItem>
                  <SelectItem value="sales_invoice">{tt('financeDocs.mz.invoiceType', 'Factura / Invoice')}</SelectItem>
                  <SelectItem value="sales_credit_note">{tt('financeDocs.mz.creditNoteType', 'Nota de Crédito / Credit Note')}</SelectItem>
                  <SelectItem value="sales_debit_note">{tt('financeDocs.mz.debitNoteType', 'Nota de Débito / Debit Note')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tt('financeDocs.mz.status', 'Status')}</Label>
              <Select
                value={exportFilters.status || 'all'}
                onValueChange={(value) => updateExportFilter('status', value as FiscalDocumentExportStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tt('common.all', 'All')}</SelectItem>
                  <SelectItem value="draft">{tt('financeDocs.workflow.draft', 'Draft')}</SelectItem>
                  <SelectItem value="issued">{tt('financeDocs.workflow.issued', 'Issued')}</SelectItem>
                  <SelectItem value="voided">{tt('financeDocs.workflow.voided', 'Voided')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tt('financeDocs.fields.customer', 'Customer')}</Label>
              <Input
                value={exportFilters.customer || ''}
                onChange={(event) => updateExportFilter('customer', event.target.value)}
                placeholder={tt('financeDocs.mz.customerFilter', 'Name or NUIT')}
              />
            </div>
            <div className="space-y-2">
              <Label>{tt('financeDocs.mz.presentationCurrency', 'Currency')}</Label>
              <Input
                value={exportFilters.currency || ''}
                onChange={(event) => updateExportFilter('currency', event.target.value.toUpperCase())}
                placeholder="MZN"
                maxLength={3}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground">
              {tt(
                'financeDocs.mz.fiscalExportScope',
                'Exports sales invoices, credit notes, debit notes, line details, available settlement status, issuer NUIT, customer NUIT, VAT totals, currency, and exchange rate.',
              )}
            </p>
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={!companyId || !canExportFiscalDocuments || exportingFiscalDocuments}
              onClick={() => void handleFiscalDocumentExport()}
            >
              <Download className="mr-2 h-4 w-4" />
              {exportingFiscalDocuments
                ? tt('actions.saving', 'Saving')
                : tt('financeDocs.mz.exportFiscalDocuments', 'Export fiscal documents')}
            </Button>
          </div>

          {!canExportFiscalDocuments ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {tt('financeDocs.mz.fiscalExportPermissionHelp', 'Fiscal document exports require an active company role with report export access.')}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className={activeView === 'history' ? 'grid gap-4 lg:grid-cols-2' : 'hidden'}>
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle>{tt('financeDocs.mz.saftTitle', 'SAF-T (Moz) run registry')}</CardTitle>
            <CardDescription className="hidden sm:block">{tt('financeDocs.mz.saftHelp', 'This is a registry of requested SAF-T preparation runs. StockWise does not yet generate an official SAF-T/XML submission file from this screen.')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
            ) : optionalUnavailable.includes('exports') ? (
              <p className="text-sm text-muted-foreground">{tt('setup.compliance.optionalUnavailable', 'This optional history could not be loaded. Its absence is not a setup result.')}</p>
            ) : exports.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tt('financeDocs.mz.saftEmpty', 'No SAF-T export runs have been recorded for this company yet.')}</p>
            ) : (
              <div className="space-y-3">
                {exports.map((row) => (
                  <div key={row.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{shortDate(row.period_start)} - {shortDate(row.period_end)}</div>
                      <Badge variant={exportTone(row.status)}>
                        {complianceStatusLabel(row.status, complianceLanguage, unavailableLabel)}
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {tt('financeDocs.mz.saftDocs', 'Documents')}: {row.source_document_count} /{' '}
                      {tt('financeDocs.mz.saftTotal', 'Total MZN')}: {row.source_total_mzn}
                    </div>
                    {row.submission_reference ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {tt('financeDocs.mz.submissionReference', 'Submission reference')}: {row.submission_reference}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle>{tt('financeDocs.mz.archiveTitle', 'Archive and artifact history')}</CardTitle>
            <CardDescription className="hidden sm:block">{tt('financeDocs.mz.archiveAdminHelp', 'This is the company-level archive registry fed by fiscal document artifacts. A storage-backed output worker is still the next step for canonical invoice files.')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
            ) : optionalUnavailable.includes('artifacts') ? (
              <p className="text-sm text-muted-foreground">{tt('setup.compliance.optionalUnavailable', 'This optional history could not be loaded. Its absence is not a setup result.')}</p>
            ) : artifacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tt('financeDocs.mz.archiveEmpty', 'No archived invoice artifacts are registered for this document yet.')}</p>
            ) : (
              <div className="space-y-3">
                {artifacts.slice(0, 10).map((row) => (
                  <div key={row.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                    <div className="font-medium">
                      {artifactBusinessName(row.file_name, tt('financeDocs.mz.archivedArtifact', 'Archived artifact'))}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {fiscalDocumentTypeLabel(row.document_kind, complianceLanguage, unavailableLabel)}
                      {' / '}
                      {complianceArtifactLabel(row.artifact_type, complianceLanguage, unavailableLabel)}
                      {' / '}
                      {tt('financeDocs.mz.retainedUntil', 'Retained until')} {shortDate(row.retained_until)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={activeView === 'history' ? 'border-border/80 shadow-sm' : 'hidden'}>
        <CardHeader>
          <CardTitle>{tt('financeDocs.mz.auditTrail', 'Audit trail')}</CardTitle>
          <CardDescription className="hidden sm:block">{tt('financeDocs.mz.auditAdminHelp', 'Recent finance-document and SAF-T activity for the active company.')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
          ) : optionalUnavailable.includes('events') ? (
            <p className="text-sm text-muted-foreground">{tt('setup.compliance.optionalUnavailable', 'This optional history could not be loaded. Its absence is not a setup result.')}</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tt('financeDocs.mz.auditEmpty', 'No audit events have been captured for this document yet.')}</p>
          ) : (
            <div className="space-y-3">
              {events.slice(0, 15).map((row) => (
                <div key={row.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      {fiscalDocumentTypeLabel(row.document_kind, complianceLanguage, unavailableLabel)}
                      {' / '}
                      {complianceEventLabel(row.event_type, complianceLanguage, unavailableLabel)}
                    </div>
                    <div className="text-xs text-muted-foreground">{row.occurred_at.replace('T', ' ').slice(0, 19)}</div>
                  </div>
                  {(row.from_status || row.to_status) ? (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {complianceStatusLabel(row.from_status, complianceLanguage, unavailableLabel)}
                      {' → '}
                      {complianceStatusLabel(row.to_status, complianceLanguage, unavailableLabel)}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
