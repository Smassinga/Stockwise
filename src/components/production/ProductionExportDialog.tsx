import { useEffect, useMemo, useState } from 'react'
import { FinanceExportDialog, type FinanceExportFormat } from '../finance/FinanceExportDialog'
import {
  exportFinanceExcel,
  exportFinancePdf,
  printFinanceReport,
  type FinanceExportLanguage,
  type FinanceExportModel,
} from '../../lib/financeExport'
import { useI18n, withI18nFallback } from '../../lib/i18n'
import { Checkbox } from '../ui/checkbox'
import { Label } from '../ui/label'

export type ProductionExportSectionOption = {
  id: string
  label: string
}

const emptySectionOptions: ProductionExportSectionOption[] = []

export function ProductionExportDialog({
  open,
  onOpenChange,
  title,
  scope,
  recordCount,
  currencyBasis,
  sectionOptions = emptySectionOptions,
  buildModel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  scope: string
  recordCount: number
  currencyBasis: string
  sectionOptions?: ProductionExportSectionOption[]
  buildModel: (language: FinanceExportLanguage, selectedSections: string[]) => Promise<FinanceExportModel>
}) {
  const { lang, t } = useI18n()
  const tt = (key: string, fallback: string) => withI18nFallback(t, key, fallback)
  const [selectedSections, setSelectedSections] = useState<string[]>(sectionOptions.map((option) => option.id))
  const sectionKey = sectionOptions.map((option) => option.id).join('|')

  useEffect(() => {
    if (open) setSelectedSections(sectionOptions.map((option) => option.id))
  }, [open, sectionKey])

  const language: FinanceExportLanguage = lang === 'pt' ? 'pt' : 'en'
  const period = useMemo(
    () => tt('productionUx.export.currentEvidence', 'Current selected evidence'),
    [lang, t],
  )

  const generate = async (format: FinanceExportFormat, selectedLanguage: FinanceExportLanguage) => {
    if (sectionOptions.length && selectedSections.length === 0) {
      throw new Error('production_export_sections_required')
    }
    const model = await buildModel(selectedLanguage, selectedSections)
    if (format === 'excel') await exportFinanceExcel(model)
    if (format === 'pdf') await exportFinancePdf(model)
    if (format === 'print') await printFinanceReport(model)
  }

  return (
    <>
      {open && sectionOptions.length ? (
        <div className="sr-only" aria-live="polite">
          {tt('productionUx.export.sectionCount', '{count} report sections selected').replace('{count}', String(selectedSections.length))}
        </div>
      ) : null}
      <FinanceExportDialog
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description={tt('productionUx.export.description', 'Review the scope before generating a company-branded operational report.')}
        scope={scope}
        period={period}
        recordCount={recordCount}
        currencyBasis={currencyBasis}
        language={language}
        labels={{
          report: tt('financeUx.report', 'Report'),
          scope: tt('financeUx.scope', 'Scope'),
          period: tt('financeUx.period', 'Period'),
          recordCount: tt('financeUx.recordCount', 'Record count'),
          currencyBasis: tt('financeUx.currencyBasis', 'Currency basis'),
          language: tt('financeUx.language', 'Language'),
          english: tt('financeUx.english', 'English'),
          portuguese: tt('financeUx.portuguese', 'Portuguese'),
          bilingual: tt('financeUx.bilingual', 'Bilingual'),
          downloadExcel: tt('financeUx.downloadExcel', 'Download Excel'),
          downloadPdf: tt('financeUx.downloadPdf', 'Download PDF'),
          print: tt('financeUx.print', 'Print'),
          cancel: tt('common.cancel', 'Cancel'),
          preparing: tt('financeUx.preparing', 'Preparing output...'),
          failed: tt('productionUx.export.failed', 'The report could not be prepared. No partial file was downloaded.'),
        }}
        onGenerate={generate}
      >
        {sectionOptions.length ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {tt('productionUx.export.sections', 'Included sections')}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {sectionOptions.map((option) => (
                <Label key={option.id} className="flex min-h-10 items-center gap-2 rounded-md border border-card-border px-3 py-2">
                  <Checkbox
                    checked={selectedSections.includes(option.id)}
                    onCheckedChange={(checked) => {
                      setSelectedSections((current) => (
                        checked
                          ? [...new Set([...current, option.id])]
                          : current.filter((id) => id !== option.id)
                      ))
                    }}
                  />
                  {option.label}
                </Label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </FinanceExportDialog>
    </>
  )
}
