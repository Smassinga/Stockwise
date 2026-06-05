import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import type { PremiumTone } from './PremiumStatusBadge'

type IconBadgeTone = PremiumTone | 'primary' | 'inverse'
type IconBadgeSize = 'compact' | 'card' | 'feature' | 'empty'

const toneClass: Record<IconBadgeTone, string> = {
  neutral: 'border-border/70 bg-surface-muted text-financial-neutral dark:border-panel-border dark:bg-white/5 dark:text-panel-premium-muted',
  positive: 'border-emerald-200 bg-emerald-50 text-financial-positive dark:border-emerald-300/25 dark:bg-emerald-300/10 dark:text-emerald-200',
  negative: 'border-rose-200 bg-rose-50 text-financial-negative dark:border-rose-300/25 dark:bg-rose-300/10 dark:text-rose-200',
  warning: 'border-amber-200 bg-amber-50 text-financial-warning dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-200',
  critical: 'border-rose-200 bg-rose-50 text-financial-critical dark:border-rose-300/30 dark:bg-rose-300/20 dark:text-rose-200',
  info: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-300/25 dark:bg-sky-300/10 dark:text-sky-200',
  primary: 'border-primary/18 bg-primary/10 text-primary dark:border-primary/30 dark:bg-primary/15 dark:text-sky-200',
  inverse: 'border-sky-300/25 bg-sky-300/10 text-sky-100',
}

const sizeClass: Record<IconBadgeSize, string> = {
  compact: 'h-9 w-9 rounded-xl [&_svg]:h-4 [&_svg]:w-4 sm:h-10 sm:w-10',
  card: 'h-9 w-9 rounded-xl [&_svg]:h-4 [&_svg]:w-4 sm:h-11 sm:w-11 sm:[&_svg]:h-[1.1rem] sm:[&_svg]:w-[1.1rem]',
  feature: 'h-11 w-11 rounded-xl [&_svg]:h-5 [&_svg]:w-5 sm:h-14 sm:w-14 sm:rounded-2xl sm:[&_svg]:h-6 sm:[&_svg]:w-6',
  empty: 'h-11 w-11 rounded-xl [&_svg]:h-5 [&_svg]:w-5 sm:h-12 sm:w-12',
}

export function IconBadge({
  children,
  tone = 'neutral',
  size = 'card',
  className,
}: {
  children: ReactNode
  tone?: IconBadgeTone
  size?: IconBadgeSize
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center border',
        toneClass[tone],
        sizeClass[size],
        className,
      )}
      aria-hidden="true"
    >
      {children}
    </span>
  )
}
