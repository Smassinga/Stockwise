import { cn } from '../../lib/utils'
import Logo from './Logo'

type Props = {
  className?: string
  variant?: 'auto' | 'light' | 'dark'
  subtitle?: string
  compact?: boolean
}

export default function BrandLockup({
  className,
  variant = 'auto',
  subtitle,
  compact = false,
}: Props) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border bg-background/80 shadow-sm">
        <Logo h={compact ? 28 : 32} alt="StockWise" variant={variant} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-lg font-semibold tracking-tight">StockWise</div>
        {!compact && subtitle ? (
          <div className="truncate text-sm text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
    </div>
  )
}
