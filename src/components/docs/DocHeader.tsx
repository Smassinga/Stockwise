// src/components/docs/DocHeader.tsx
import { useMemo } from 'react'

type Props = {
  companyName?: string | null
  logoUrl?: string | null
  fallbackName?: string | null
  rightSlot?: React.ReactNode
  className?: string
}

function initials(s?: string | null) {
  const t = (s || '').trim()
  if (!t) return '—'
  const parts = t.split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || t[0]?.toUpperCase() || '—'
}

export default function DocHeader({ companyName, fallbackName, logoUrl, rightSlot, className }: Props) {
  const name = (companyName ?? '').trim() || (fallbackName ?? '').trim()
  const init = useMemo(() => initials(name), [name])

  return (
    <div className={`flex items-center justify-between gap-6 border-b pb-4 mb-4 ${className || ''}`}>
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={name || 'Company logo'}
            className="h-10 w-auto rounded-md border border-border bg-card p-1"
            onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="h-10 w-10 rounded-md border border-border bg-muted flex items-center justify-center font-semibold">
            {init}
          </div>
        )}
        <div className="text-base font-semibold">{name || '—'}</div>
      </div>
      <div className="text-right">{rightSlot}</div>
    </div>
  )
}
