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
    <div className={cn('inline-flex flex-col gap-2', className)}>
      <div
        className={cn(
          'inline-flex w-fit items-center rounded-[22px] border border-border/70 bg-white/95 shadow-[0_20px_50px_-32px_rgba(15,23,42,0.55)]',
          compact ? 'px-3 py-2' : 'px-4 py-3',
        )}
      >
        <Logo h={compact ? 28 : 34} alt="StockWise" variant={variant} />
      </div>
      {!compact && subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
    </div>
  )
}
