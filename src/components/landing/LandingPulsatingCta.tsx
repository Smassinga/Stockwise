import { useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { cn } from '../../lib/utils'

type LandingPulsatingCtaProps = {
  to: LinkProps['to']
  children: ReactNode
  className?: string
}

export function LandingPulsatingCta({
  to,
  children,
  className,
}: LandingPulsatingCtaProps) {
  const reduceMotion = useReducedMotion()

  return (
    <Link
      to={to}
      className={cn(
        'landing-pulsating-cta relative inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary bg-primary px-8 py-2 text-sm font-semibold text-primary-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-black',
        className,
      )}
    >
      {!reduceMotion ? (
        <span
          className="landing-pulsating-cta__pulse pointer-events-none absolute inset-0 rounded-[inherit]"
          aria-hidden="true"
        />
      ) : null}
      <span className="relative z-10">{children}</span>
      <ArrowRight className="relative z-10 h-4 w-4" aria-hidden="true" />
    </Link>
  )
}
