import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function PremiumImportExportActions({
  importAction,
  exportAction,
  children,
  className,
}: {
  importAction?: ReactNode
  exportAction?: ReactNode
  children?: ReactNode
  className?: string
}) {
  if (!importAction && !exportAction && !children) return null

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {importAction}
      {exportAction}
      {children}
    </div>
  )
}
