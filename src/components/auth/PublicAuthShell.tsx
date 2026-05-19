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
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-primary/10 via-muted/35 to-background" />
      <div className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 hidden w-px bg-border/60 lg:block" />
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
          <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)] lg:items-center">
            <div className="hidden max-w-xl lg:block">
              <div className="inline-flex items-center rounded-full border border-primary/20 bg-background/90 px-4 py-2 text-sm font-medium text-primary shadow-sm">
                <ShieldCheck className="mr-2 h-4 w-4" />
                StockWise
              </div>
              <h1 className="mt-6 text-4xl font-semibold leading-tight">{heroTitle}</h1>
              <p className="mt-5 text-lg leading-8 text-muted-foreground">{heroBody}</p>
              <div className="mt-8 grid gap-3">
                {highlights.map((item) => (
                  <div
                    key={item}
                    className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-background/88 p-4 shadow-sm transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-primary/25"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
                      <Warehouse className="h-4 w-4" />
                    </span>
                    <span className="text-sm text-muted-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-w-0">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
