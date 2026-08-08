import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import BrandLockup from '../brand/BrandLockup'
import LocaleToggle from '../LocaleToggle'
import ThemeToggle from '../ThemeToggle'

type Props = {
  children: ReactNode
  subtitle?: string
  contextTitle: string
  contextBody: string
}

export default function PublicAuthShell({
  children,
  subtitle,
  contextTitle,
  contextBody,
}: Props) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <BrandLockup subtitle={subtitle} />
          </Link>
          <div className="flex items-center gap-2">
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </div>

        <main className="flex flex-1 items-center py-10 lg:py-14">
          <div className="grid w-full gap-10 lg:grid-cols-[minmax(0,0.72fr)_minmax(420px,540px)] lg:items-center lg:gap-20">
            <div className="max-w-xl border-l-2 border-primary pl-5 sm:pl-7">
              <p className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
                {contextTitle}
              </p>
              <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                {contextBody}
              </p>
            </div>

            <div className="min-w-0">{children}</div>
          </div>
        </main>
      </div>
    </div>
  )
}
