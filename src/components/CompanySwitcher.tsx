// src/components/CompanySwitcher.tsx
import { useMemo } from 'react'
import { useOrg } from '../hooks/useOrg'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

export default function CompanySwitcher({ className }: { className?: string }) {
  const { companies, companyId, setActiveCompany } = useOrg()
  const options = useMemo(() => companies.map(c => ({ id: c.id, label: c.name || c.id })), [companies])

  if (options.length <= 1) return null

  return (
    <div className={className}>
      <Select value={companyId ?? undefined} onValueChange={(v) => setActiveCompany(v)}>
        <SelectTrigger className="w-[240px]">
          <SelectValue placeholder="Select company" />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
