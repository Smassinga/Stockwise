import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type AdministrationSection = {
  value: string
  label: string
  icon?: ReactNode
}

type Props = {
  label: string
  sections: AdministrationSection[]
  value: string
  onChange: (value: string) => void
}

export function AdministrationSectionNav({ label, sections, value, onChange }: Props) {
  return (
    <nav aria-label={label} className="overflow-x-auto rounded-lg border border-border/70 bg-card p-1">
      <div className="flex min-w-max gap-1">
        {sections.map((section) => (
          <button
            key={section.value}
            type="button"
            aria-current={value === section.value ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              value === section.value && 'bg-primary text-primary-foreground',
            )}
            onClick={() => onChange(section.value)}
          >
            {section.icon}
            <span>{section.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
