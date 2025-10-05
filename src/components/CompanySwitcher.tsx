// src/components/CompanySwitcher.tsx
import { useMemo } from 'react'
import { useOrg } from '../hooks/useOrg'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { useI18n } from '../lib/i18n'

export default function CompanySwitcher({ className }: { className?: string }) {
  const { t } = useI18n()
  const { companies, companyId, setActiveCompany } = useOrg()
  const options = useMemo(() => companies.map(c => ({ id: c.id, label: c.name || c.id })), [companies])

  if (options.length <= 1) return null

  return (
    <div className={className}>
      <Select value={companyId ?? undefined} onValueChange={(v) => setActiveCompany(v)}>
        <SelectTrigger className="w-[240px]">
          <SelectValue placeholder={t('company.selectCompany')} />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
