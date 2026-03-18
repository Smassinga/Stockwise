// src/components/CompanySwitcher.tsx
import { useMemo } from 'react'
import { useOrg } from '../hooks/useOrg'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { useI18n } from '../lib/i18n'
import { Building2 } from 'lucide-react'
import { cn } from '../lib/utils'

export default function CompanySwitcher({ className }: { className?: string }) {
  const { t } = useI18n()
  const { companies, companyId, companyName, setActiveCompany, switching } = useOrg()
  const options = useMemo(
    () => companies.map(c => ({ id: c.id, label: c.name || c.id })),
    [companies]
  )
  const activeLabel =
    options.find((option) => option.id === companyId)?.label ||
    companyName ||
    t('company.selectCompany') ||
    'Select company'

  if (!options.length && !activeLabel) return null

  if (options.length <= 1) {
    return (
      <div
        className={cn(
          'flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-foreground/90',
          className
        )}
        aria-busy={switching || undefined}
      >
        <Building2 className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate">{activeLabel}</span>
      </div>
    )
  }

  return (
    <div className={className} aria-busy={switching || undefined}>
      <Select
        value={companyId ?? ''}
        onValueChange={(v) => setActiveCompany(String(v))}
        disabled={switching}
      >
        <SelectTrigger
          className="min-w-0 max-w-full gap-2 sm:w-[180px] lg:w-[200px] xl:w-[240px]"
          aria-label={t('company.selectCompany') || 'Select company'}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-primary" />
            <SelectValue placeholder={t('company.selectCompany') || 'Select company'} />
          </div>
        </SelectTrigger>
        <SelectContent>
          {options.map(o => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
