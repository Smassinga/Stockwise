// src/pages/reports/KPI.tsx

export default function KPI({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1 break-words">{value}</div>
    </div>
  )
}
