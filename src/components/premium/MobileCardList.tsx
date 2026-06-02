import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function MobileCardList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('space-y-3 md:hidden', className)}>{children}</div>
}
