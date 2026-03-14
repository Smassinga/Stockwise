import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, Warehouse } from 'lucide-react'
import BrandLockup from '../brand/BrandLockup'
import LocaleToggle from '../LocaleToggle'
import ThemeToggle from '../ThemeToggle'

type Props = {
  children: ReactNode
  subtitle: string
  heroTitle: string
  heroBody: string
  highlights: string[]
}

export default function PublicAuthShell({
  children,
  subtitle,
  heroTitle,
  heroBody,
  highlights,
}: Props) {
  return (
    <div className="min-h-screen bg-background">
      <div className="absolute inset-x-0 top-0 -z-10 h-[440px] bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.16),_transparent_44%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.16),_transparent_28%)]" />
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <Link to="/">
            <BrandLockup subtitle={subtitle} />
          </Link>
          <div className="flex items-center gap-2">
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center py-8 lg:py-12">
          <div className="grid w-full gap-8 lg:grid-cols-[1fr_460px] lg:items-center">
            <div className="hidden max-w-xl lg:block">
              <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-primary">
                <ShieldCheck className="mr-2 h-4 w-4" />
                StockWise
              </div>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight">{heroTitle}</h1>
              <p className="mt-5 text-lg leading-8 text-muted-foreground">{heroBody}</p>
              <div className="mt-8 space-y-3">
                {highlights.map((item) => (
                  <div
                    key={item}
                    className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/85 p-4 shadow-sm"
                  >
                    <Warehouse className="mt-0.5 h-4 w-4 text-primary" />
                    <span className="text-sm text-muted-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
