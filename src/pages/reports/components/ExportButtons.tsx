// src/pages/reports/components/ExportButtons.tsx
import { Button } from '../../../components/ui/button'

export default function ExportButtons({
  onCSV, onXLSX, onPDF, className = ''
}: { onCSV: () => void; onXLSX: () => void; onPDF: () => void; className?: string }) {
  return (
    <div className={`mt-4 mb-2 flex gap-2 ${className}`}>
      <Button type="button" variant="outline" onClick={onCSV}>Export CSV</Button>
      <Button type="button" variant="outline" onClick={onXLSX}>Export XLSX</Button>
      <Button type="button" variant="outline" onClick={onPDF}>Export PDF</Button>
    </div>
  )
}
