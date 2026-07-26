import { useEffect, useState } from 'react'
import { FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { FinanceExportLanguage } from '../../lib/financeExport'

export type FinanceExportFormat = 'excel' | 'pdf' | 'print'

export function FinanceExportDialog({
  open,
  onOpenChange,
  title,
  description,
  scope,
  period,
  recordCount,
  currencyBasis,
  language,
  allowBilingual = false,
  labels,
  onGenerate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  scope: string
  period?: string | null
  recordCount: number
  currencyBasis: string
  language: FinanceExportLanguage
  allowBilingual?: boolean
  labels: {
    report: string
    scope: string
    period: string
    recordCount: string
    currencyBasis: string
    language: string
    english: string
    portuguese: string
    bilingual: string
    downloadExcel: string
    downloadPdf: string
    print: string
    cancel: string
    preparing: string
    failed: string
  }
  onGenerate: (format: FinanceExportFormat, language: FinanceExportLanguage) => Promise<void>
}) {
  const [selectedLanguage, setSelectedLanguage] = useState<FinanceExportLanguage>(language)
  const [generating, setGenerating] = useState<FinanceExportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedLanguage(language)
    setError(null)
  }, [language, open])

  const generate = async (format: FinanceExportFormat) => {
    setGenerating(format)
    setError(null)
    try {
      await onGenerate(format, selectedLanguage)
    } catch (caught) {
      console.error('[finance-export] generation failed', caught)
      setError(labels.failed)
    } finally {
      setGenerating(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!generating) onOpenChange(nextOpen)
    }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody>
          <dl className="grid gap-3 rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-surface-muted/45 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="premium-label">{labels.report}</dt>
              <dd className="mt-1 font-medium text-foreground">{title}</dd>
            </div>
            <div>
              <dt className="premium-label">{labels.scope}</dt>
              <dd className="mt-1 font-medium text-foreground">{scope}</dd>
            </div>
            <div>
              <dt className="premium-label">{labels.period}</dt>
              <dd className="mt-1 font-medium text-foreground">{period || '—'}</dd>
            </div>
            <div>
              <dt className="premium-label">{labels.recordCount}</dt>
              <dd className="mt-1 font-medium text-foreground">{recordCount}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="premium-label">{labels.currencyBasis}</dt>
              <dd className="mt-1 font-medium text-foreground">{currencyBasis}</dd>
            </div>
          </dl>

          {allowBilingual ? (
            <div className="mt-4 space-y-2">
              <Label>{labels.language}</Label>
              <Select value={selectedLanguage} onValueChange={(value) => setSelectedLanguage(value as FinanceExportLanguage)}>
                <SelectTrigger aria-label={labels.language}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{labels.english}</SelectItem>
                  <SelectItem value="pt">{labels.portuguese}</SelectItem>
                  <SelectItem value="bi">{labels.bilingual}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="mt-5 grid gap-2 sm:grid-cols-3" aria-live="polite" aria-busy={Boolean(generating)}>
            <Button variant="outline" onClick={() => generate('excel')} disabled={Boolean(generating)}>
              <FileSpreadsheet className="h-4 w-4" />
              {generating === 'excel' ? labels.preparing : labels.downloadExcel}
            </Button>
            <Button variant="outline" onClick={() => generate('pdf')} disabled={Boolean(generating)}>
              <FileText className="h-4 w-4" />
              {generating === 'pdf' ? labels.preparing : labels.downloadPdf}
            </Button>
            <Button variant="outline" onClick={() => generate('print')} disabled={Boolean(generating)}>
              <Printer className="h-4 w-4" />
              {generating === 'print' ? labels.preparing : labels.print}
            </Button>
          </div>
          {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={Boolean(generating)}>
            {labels.cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
