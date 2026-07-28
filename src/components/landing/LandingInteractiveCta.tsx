import { useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { cn } from '../../lib/utils'

type SharedProps = {
  children: ReactNode
  className?: string
  tone?: 'primary' | 'light-outline'
}

type RouteCtaProps = SharedProps & {
  to: LinkProps['to']
  href?: never
  onClick?: LinkProps['onClick']
}

type AnchorCtaProps = SharedProps & {
  href: string
  to?: never
  onClick?: AnchorHTMLAttributes<HTMLAnchorElement>['onClick']
}

export type LandingInteractiveCtaProps = RouteCtaProps | AnchorCtaProps

export function LandingInteractiveCta({
  children,
  className,
  tone = 'primary',
  ...destination
}: LandingInteractiveCtaProps) {
  const reduceMotion = useReducedMotion()
  const classes = cn(
    'landing-interactive-cta group/cta relative inline-flex min-h-11 items-center justify-center overflow-hidden rounded-xl border px-6 py-2 text-sm font-semibold',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    tone === 'primary'
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-white/30 bg-transparent text-white focus-visible:ring-white focus-visible:ring-offset-black',
    reduceMotion && 'landing-interactive-cta--static',
    className,
  )

  const content = (
    <>
      <span className="landing-interactive-cta__accent" aria-hidden="true" />
      <span className="landing-interactive-cta__label">{children}</span>
      <ArrowRight className="landing-interactive-cta__arrow h-4 w-4" aria-hidden="true" />
    </>
  )

  if ('to' in destination) {
    return (
      <Link to={destination.to} onClick={destination.onClick} className={classes}>
        {content}
      </Link>
    )
  }

  return (
    <a href={destination.href} onClick={destination.onClick} className={classes}>
      {content}
    </a>
  )
}
