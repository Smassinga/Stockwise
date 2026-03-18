import { useState } from 'react'
import { Button } from '../../../components/ui/button'
import { useI18n, withI18nFallback } from '../../../lib/i18n'

export default function ExportButtons({
  onCSV,
  onXLSX,
  onPDF,
  className = '',
}: {
  onCSV: () => void | Promise<void>
  onXLSX: () => void | Promise<void>
  onPDF: () => void | Promise<void>
  className?: string
}) {
  const { t } = useI18n()
  const tt = (key: string, fallback: string) => withI18nFallback(t, key, fallback)
  const [busy, setBusy] = useState<'csv' | 'xlsx' | 'pdf' | null>(null)

  async function run(kind: 'csv' | 'xlsx' | 'pdf', action: () => void | Promise<void>) {
    try {
      setBusy(kind)
      await action()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={`mb-2 mt-4 flex flex-wrap gap-2 ${className}`}>
      <Button type="button" variant="outline" disabled={!!busy} onClick={() => void run('csv', onCSV)}>
        {busy === 'csv' ? tt('export.preparingCsv', 'Preparing CSV...') : tt('export.csv', 'Export CSV')}
      </Button>
      <Button type="button" variant="outline" disabled={!!busy} onClick={() => void run('xlsx', onXLSX)}>
        {busy === 'xlsx'
          ? tt('export.preparingXlsx', 'Preparing Excel...')
          : tt('export.xlsx', 'Export Excel')}
      </Button>
      <Button type="button" variant="outline" disabled={!!busy} onClick={() => void run('pdf', onPDF)}>
        {busy === 'pdf' ? tt('export.preparingPdf', 'Preparing PDF...') : tt('export.pdf', 'Export PDF')}
      </Button>
    </div>
  )
}
