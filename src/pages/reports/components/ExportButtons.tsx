// src/pages/reports/components/ExportButtons.tsx
import { useState } from 'react'
import { Button } from '../../../components/ui/button'

export default function ExportButtons({
  onCSV, onXLSX, onPDF, className = ''
}: { onCSV: () => void | Promise<void>; onXLSX: () => void | Promise<void>; onPDF: () => void | Promise<void>; className?: string }) {
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
        {busy === 'csv' ? 'Preparing CSV…' : 'Export CSV'}
      </Button>
      <Button type="button" variant="outline" disabled={!!busy} onClick={() => void run('xlsx', onXLSX)}>
        {busy === 'xlsx' ? 'Preparing XLSX…' : 'Export XLSX'}
      </Button>
      <Button type="button" variant="outline" disabled={!!busy} onClick={() => void run('pdf', onPDF)}>
        {busy === 'pdf' ? 'Preparing PDF…' : 'Export PDF'}
      </Button>
    </div>
  )
}
