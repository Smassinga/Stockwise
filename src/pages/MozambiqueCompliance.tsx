import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { useOrg } from '../hooks/useOrg'
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
  return text ? text.slice(0, 10) : '—'
}

export default function MozambiqueCompliancePage() {
  const { companyId, companyName } = useOrg()
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)

  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<CompanyFiscalSettingsRow | null>(null)
  const [series, setSeries] = useState<FinanceDocumentFiscalSeriesRow[]>([])
  const [exports, setExports] = useState<SaftMozExportRow[]>([])
  const [events, setEvents] = useState<FinanceDocumentEventRow[]>([])
  const [artifacts, setArtifacts] = useState<FiscalDocumentArtifactRow[]>([])

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
        return
      }

      try {
        setLoading(true)
        const [nextSettings, nextSeries, nextExports, nextEvents, nextArtifacts] = await Promise.all([
          getCompanyFiscalSettings(companyId),
          listCompanyFiscalSeries(companyId),
          listSaftMozExports(companyId),
          listFinanceEvents(companyId),
          listFiscalArtifacts(companyId),
        ])

        if (!active) return
        setSettings(nextSettings)
        setSeries(nextSeries)
        setExports(nextExports)
        setEvents(nextEvents)
        setArtifacts(nextArtifacts)
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
  }, [companyId])

  const activeSeries = series.filter((row) => row.is_active).sort((left, right) =>
    `${left.fiscal_year}-${left.document_type}`.localeCompare(`${right.fiscal_year}-${right.document_type}`),
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
            {tt('financeDocs.mz.complianceEyebrow', 'Mozambique compliance')}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{tt('financeDocs.mz.complianceTitle', 'Fiscal compliance')}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {tt('financeDocs.mz.complianceSubtitle', 'Review the live fiscal settings, active series, SAF-T history, archive rows, and audit activity that support Mozambique issuance readiness.')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/sales-invoices">{tt('financeDocs.salesInvoices.title', 'Sales Invoices')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/orders?tab=sales">{tt('financeDocs.salesInvoices.ordersLink', 'View sales orders')}</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle>{tt('financeDocs.mz.settingsTitle', 'Company fiscal settings')}</CardTitle>
            <CardDescription>{companyName || companyId || '—'}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
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

        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle>{tt('financeDocs.mz.seriesTitle', 'Active fiscal series')}</CardTitle>
            <CardDescription>{tt('financeDocs.mz.seriesHelp', 'These rows drive the next legal references for invoice, credit note, and debit note issuance.')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
            ) : activeSeries.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tt('financeDocs.mz.seriesEmpty', 'No active fiscal series are configured for the current company.')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tt('financeDocs.mz.documentType', 'Document type')}</TableHead>
                    <TableHead>{tt('financeDocs.mz.seriesCode', 'Series')}</TableHead>
                    <TableHead>{tt('common.year', 'Year')}</TableHead>
                    <TableHead className="text-right">{tt('financeDocs.mz.nextNumber', 'Next number')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeSeries.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.document_type}</TableCell>
                      <TableCell>{row.series_code}</TableCell>
                      <TableCell>{row.fiscal_year}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{row.next_number}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle>{tt('financeDocs.mz.saftTitle', 'SAF-T (Moz) history')}</CardTitle>
            <CardDescription>{tt('financeDocs.mz.saftHelp', 'The DB-side run history is live. The remaining app step is a storage-backed generation and submission workflow instead of a read-only history view.')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
            ) : exports.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tt('financeDocs.mz.saftEmpty', 'No SAF-T export runs have been recorded for this company yet.')}</p>
            ) : (
              <div className="space-y-3">
                {exports.map((row) => (
                  <div key={row.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{shortDate(row.period_start)} → {shortDate(row.period_end)}</div>
                      <Badge variant={exportTone(row.status)}>{row.status.toUpperCase()}</Badge>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {tt('financeDocs.mz.saftDocs', 'Documents')}: {row.source_document_count} ·
                      {' '}
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
            <CardDescription>{tt('financeDocs.mz.archiveAdminHelp', 'This is the company-level archive registry fed by fiscal document artifacts. A storage-backed output worker is still the next step for canonical invoice files.')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
            ) : artifacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tt('financeDocs.mz.archiveEmpty', 'No archived invoice artifacts are registered for this document yet.')}</p>
            ) : (
              <div className="space-y-3">
                {artifacts.slice(0, 10).map((row) => (
                  <div key={row.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                    <div className="font-medium">{row.file_name || row.storage_path}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {row.document_kind} · {row.artifact_type} · {tt('financeDocs.mz.retainedUntil', 'Retained until')} {shortDate(row.retained_until)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>{tt('financeDocs.mz.auditTrail', 'Audit trail')}</CardTitle>
          <CardDescription>{tt('financeDocs.mz.auditAdminHelp', 'Recent finance-document and SAF-T activity for the active company.')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tt('financeDocs.mz.auditEmpty', 'No audit events have been captured for this document yet.')}</p>
          ) : (
            <div className="space-y-3">
              {events.slice(0, 15).map((row) => (
                <div key={row.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{row.document_kind} · {row.event_type}</div>
                    <div className="text-xs text-muted-foreground">{row.occurred_at.replace('T', ' ').slice(0, 19)}</div>
                  </div>
                  {(row.from_status || row.to_status) ? (
                    <div className="mt-1 text-sm text-muted-foreground">{row.from_status || '—'} → {row.to_status || '—'}</div>
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
