// src/components/layout/AppLayout.tsx
import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutGrid,
  Package,
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Users as UsersIcon,
  Users,
  ShoppingCart,
  Coins,
  Truck,
  Settings as SettingsIcon,
  Menu,
  LogOut,
  Layers,          // BOM
  Receipt,         // Transactions icon
  FileText,        // Finance documents
  Wallet,          // Cash icon
  Banknote,        // Banks icon
  CreditCard,      // Settlements icon
  Calculator,      // Landed cost icon
  Ruler,           // UoM
  ClipboardList,   // Stock Levels
  ShieldCheck,     // Mozambique compliance
  X,
  Search,
  ChevronDown,
  ShoppingBasket,
  Upload,
} from 'lucide-react'
import { AppUser, useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'
import { useOrg } from '../../hooks/useOrg'
import { getPlatformAdminStatus } from '../../lib/companyAccess'
import { hasRole, CanManageUsers } from '../../lib/roles'
import ThemeToggle from '../ThemeToggle'
import { NotificationCenter } from '../notifications/NotificationCenter'
import CompanySwitcher from '../CompanySwitcher'
import { useI18n, withI18nFallback } from '../../lib/i18n'
import BrandLockup from '../brand/BrandLockup'
import LocaleToggle from '../LocaleToggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

type Props = { user: AppUser; children: ReactNode }

type NavItem = {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
}

type NavSection = {
  label: string
  items: NavItem[]
}

function buildNavLabels(tt: (key: string, fallback: string) => string): NavItem[] {
  return [
    { label: tt('nav.dashboard', 'Dashboard'), to: '/dashboard', icon: LayoutGrid },
    { label: tt('nav.operator', 'Operator'), to: '/operator', icon: ShoppingBasket },
    { label: tt('nav.items', 'Items'), to: '/items', icon: Package },
    { label: tt('nav.bom', 'BOM'), to: '/bom', icon: Layers },
    { label: tt('nav.movements', 'Movements'), to: '/movements', icon: ArrowLeftRight },
    { label: tt('nav.transactions', 'Transactions'), to: '/transactions', icon: Receipt },
    { label: tt('nav.cash', 'Cash'), to: '/cash', icon: Wallet },
    { label: tt('nav.banks', 'Banks'), to: '/banks', icon: Banknote },
    { label: tt('nav.orders', 'Orders'), to: '/orders', icon: ShoppingCart },
    { label: tt('nav.salesInvoices', 'Sales Invoices'), to: '/sales-invoices', icon: Receipt },
    { label: tt('nav.complianceMz', 'Mozambique Compliance'), to: '/compliance/mz', icon: ShieldCheck },
    { label: tt('nav.vendorBills', 'Vendor Bills'), to: '/vendor-bills', icon: FileText },
    { label: tt('nav.settlements', 'Settlements'), to: '/settlements', icon: CreditCard },
    { label: tt('nav.landedCost', 'Landed Cost'), to: '/landed-cost', icon: Calculator },
    { label: tt('nav.reports', 'Reports'), to: '/reports', icon: BarChart3 },
    { label: tt('nav.stockLevels', 'Stock Levels'), to: '/stock-levels', icon: ClipboardList },
    { label: tt('nav.warehouses', 'Warehouses'), to: '/warehouses', icon: Boxes },
    { label: tt('nav.users', 'Users'), to: '/users', icon: UsersIcon },
    { label: tt('nav.customers', 'Customers'), to: '/customers', icon: Users },
    { label: tt('nav.suppliers', 'Suppliers'), to: '/suppliers', icon: Truck },
    { label: tt('nav.currency', 'Currency'), to: '/currency', icon: Coins },
    { label: tt('nav.uom', 'UoM'), to: '/uom', icon: Ruler },
    { label: tt('nav.imports', 'Imports'), to: '/setup/import', icon: Upload },
    { label: tt('nav.settings', 'Settings'), to: '/settings', icon: SettingsIcon },
  ]
}

function SearchBar({
  placeholder,
  value,
  onChange,
  onSubmit,
  className,
}: {
  placeholder: string
  value: string
  onChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  className?: string
}) {
  return (
    <form onSubmit={onSubmit} className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        className="h-10 rounded-xl border-border/70 bg-muted/20 pl-9 shadow-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </form>
  )
}

export function AppLayout({ user, children }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { logout } = useAuth() as any
  const { companyName, myRole } = useOrg()
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const [searchQuery, setSearchQuery] = useState('')
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const searchPlaceholder = tt('common.searchPlaceholder', 'Search items, orders, invoices, bills, customers...')
  const displayName = useMemo(() => {
    const rawName = user.name?.trim()
    if (rawName && rawName !== user.email) return rawName
    if (user.email?.includes('@')) return user.email.split('@')[0]
    return rawName || tt('shell.account.userFallback', 'Account')
  }, [tt, user.email, user.name])
  const displayEmail = user.email?.trim() || tt('shell.account.noEmail', 'No email on file')
  const displayCompany = companyName?.trim() || tt('shell.account.companyFallback', 'No company selected')
  const displayRole = useMemo(() => {
    if (!myRole) return tt('shell.account.roleFallback', 'Team member')
    return String(myRole)
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }, [myRole, tt])

  const nav = useMemo(() => {
    const canManage = hasRole(myRole, [...CanManageUsers])
    const base = buildNavLabels((key, fallback) => tt(key, fallback))
    const filtered = base.filter(item => !(item.to === '/users' && !canManage))
    if (isPlatformAdmin) {
      filtered.push({
        label: tt('platform.eyebrow', 'Platform control'),
        to: '/platform-control',
        icon: ShieldCheck,
      })
    }
    return filtered
  }, [isPlatformAdmin, myRole, tt])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const status = await getPlatformAdminStatus()
        if (!cancelled) setIsPlatformAdmin(Boolean(status?.is_admin))
      } catch (error) {
        console.error('[PlatformControl] status load failed', error)
        if (!cancelled) setIsPlatformAdmin(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const navSections = useMemo<NavSection[]>(
    () => {
      const sectionMap = new Map([
        [
          tt('shell.nav.operations', 'Operations'),
          ['/dashboard', '/operator', '/items', '/bom', '/movements', '/stock-levels', '/warehouses'],
        ],
        [
          tt('shell.nav.commercial', 'Commercial & finance'),
          ['/orders', '/sales-invoices', '/compliance/mz', '/vendor-bills', '/settlements', '/transactions', '/cash', '/banks', '/landed-cost', '/reports'],
        ],
        [
          tt('shell.nav.setup', 'Setup'),
          ['/customers', '/suppliers', '/users', '/currency', '/uom', '/setup/import', '/settings'],
        ],
      ])

      if (isPlatformAdmin) {
        sectionMap.set(tt('shell.nav.platform', 'Platform'), ['/platform-control'])
      }

      return Array.from(sectionMap.entries()).map(([label, routes]) => ({
        label,
        items: routes
          .map((route) => nav.find((item) => item.to === route))
          .filter((item): item is NavItem => Boolean(item)),
      }))
    },
    [isPlatformAdmin, nav, tt]
  )

  const isActive = (to: string) =>
    location.pathname === to || location.pathname.startsWith(to + '/')

  const NavLink = ({ item }: { item: NavItem }) => {
    const Icon = item.icon
    const active = isActive(item.to)
    return (
      <Link
        to={item.to}
        onClick={() => setOpen(false)}
        className={cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          active
            ? 'bg-primary/10 text-primary'
            : 'text-foreground/78 hover:bg-accent/40 hover:text-foreground'
        )}
      >
        <Icon className="h-5 w-5 flex-shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    )
  }

  const sidebar = useMemo(
    () => (
      <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:border-border/80 md:bg-muted/10">
        <div className="flex h-16 items-center gap-2 border-b border-border/70 px-4">
          <BrandLockup compact subtitle="" />
            <div className="ml-2 shrink-0 overflow-visible">
              <ThemeToggle />
            </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {navSections.map((section) => (
            <div key={section.label} className="space-y-1.5">
              <div className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {section.label}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavLink key={item.to} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-border/70 space-y-3 p-3">
          <CompanySwitcher className="mb-3" />
            <div className="rounded-2xl border border-border/70 bg-background/80 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground truncate">{displayCompany}</div>
              <div className="mt-1 text-sm font-medium truncate">{displayName}</div>
              <div className="text-xs text-muted-foreground">{displayRole}</div>
              {isPlatformAdmin ? (
                <div className="mt-2 inline-flex rounded-full border border-primary/20 bg-primary/8 px-2 py-1 text-[11px] font-medium text-primary">
                  {tt('platform.adminBadge', 'Platform admin')}
                </div>
              ) : null}
            </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => logout?.()}
          >
            <LogOut className="mr-2 h-4 w-4" />
            {t('common.signOut')}
          </Button>
        </div>
      </aside>
    ),
    [displayCompany, displayName, displayRole, logout, navSections, t]
  )

  const handleSearch = (e: FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return
    // Navigate to search results page with query parameter
    navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`)
  }

  const initial = (displayName || 'A').charAt(0).toUpperCase()
  const mobilePrimaryNav = useMemo(
    () => ['/dashboard', '/operator', '/orders', '/items']
      .map((route) => nav.find((item) => item.to === route))
      .filter((item): item is NavItem => Boolean(item)),
    [nav],
  )
  const mobileShowsMoreActive = useMemo(
    () => !mobilePrimaryNav.some((item) => isActive(item.to)),
    [location.pathname, mobilePrimaryNav],
  )

  return (
    <div className="flex min-h-screen">
      {sidebar}

      {/* Mobile overlay */}
      {open && (
        <div 
          className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-background transition-transform duration-300 ease-in-out md:hidden',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <BrandLockup compact subtitle="" />
            <div className="ml-2 shrink-0 overflow-visible">
              <ThemeToggle compact />
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setOpen(false)} 
            aria-label="Close menu"
            className="h-9 w-9"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="px-3 pb-2">
          <CompanySwitcher />
        </div>
        <nav className="space-y-5 px-3 py-2">
          {navSections.map((section) => (
            <div key={section.label} className="space-y-1.5">
              <div className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {section.label}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavLink key={item.to} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>
          <div className="mt-auto border-t p-3">
            <div className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground truncate">{displayCompany}</div>
              <div className="mt-1 text-sm font-medium truncate">{displayName}</div>
              <div className="text-xs text-muted-foreground">{displayRole}</div>
              {isPlatformAdmin ? (
                <div className="mt-2 inline-flex rounded-full border border-primary/20 bg-primary/8 px-2 py-1 text-[11px] font-medium text-primary">
                  {tt('platform.adminBadge', 'Platform admin')}
                </div>
              ) : null}
            </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start"
            onClick={() => { setOpen(false); logout?.() }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            {t('common.signOut')}
          </Button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/80 bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/88 md:px-6">
          <Button 
            variant="ghost" 
            size="icon" 
            className="md:hidden h-9 w-9" 
            onClick={() => setOpen(true)} 
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          
          {/* Mobile search form */}
          <div className="ml-1 flex-1 md:hidden">
            <SearchBar
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={setSearchQuery}
              onSubmit={handleSearch}
            />
          </div>
          
          {/* Desktop search form */}
          <div className="ml-1 hidden min-w-0 flex-1 md:flex">
            <SearchBar
              className="w-full max-w-sm lg:max-w-md xl:max-w-lg"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={setSearchQuery}
              onSubmit={handleSearch}
            />
          </div>
          
          <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2">
            <LocaleToggle className="hidden xl:inline-flex" />
            <NotificationCenter />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="hidden h-10 items-center gap-2 rounded-xl border-border/70 bg-background/80 px-2.5 md:inline-flex"
                  aria-label="User menu"
                >
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-muted/80 text-xs font-semibold text-foreground">
                    {initial}
                  </span>
                  <span className="hidden max-w-[9rem] min-w-0 text-left xl:block">
                    <span className="block truncate text-sm font-medium leading-tight">{displayName}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{displayRole}</span>
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <div className="px-2 py-2">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    {tt('shell.account.signedInAs', 'Signed in as')}
                  </div>
                  <div className="mt-1 text-sm font-semibold truncate">{displayName}</div>
                  <div className="text-xs text-muted-foreground truncate">{displayEmail}</div>
                  <div className="mt-2 text-xs text-muted-foreground truncate">{displayCompany}</div>
                  {isPlatformAdmin ? (
                    <div className="mt-2 inline-flex rounded-full border border-primary/20 bg-primary/8 px-2 py-1 text-[11px] font-medium text-primary">
                      {tt('platform.adminBadge', 'Platform admin')}
                    </div>
                  ) : null}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/profile')}>
                  <Users className="h-4 w-4" />
                  {t('common.profile')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  <SettingsIcon className="h-4 w-4" />
                  {t('common.settings')}
                </DropdownMenuItem>
                {isPlatformAdmin ? (
                  <DropdownMenuItem onClick={() => navigate('/platform-control')}>
                    <ShieldCheck className="h-4 w-4" />
                    {tt('platform.eyebrow', 'Platform control')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout?.()}>
                  <LogOut className="h-4 w-4" />
                  {t('common.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-4 md:p-6">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-background/95 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/92 md:hidden">
          <div className="grid grid-cols-5 gap-1">
            {mobilePrimaryNav.map((item) => {
              const Icon = item.icon
              const active = isActive(item.to)
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'flex min-h-[4.25rem] flex-col items-center justify-center rounded-2xl px-2 text-center transition-colors',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="mt-1 text-[11px] font-medium leading-tight">{item.label}</span>
                </Link>
              )
            })}
            <button
              type="button"
              className={cn(
                'flex min-h-[4.25rem] flex-col items-center justify-center rounded-2xl px-2 text-center transition-colors',
                mobileShowsMoreActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
              )}
              onClick={() => setOpen(true)}
            >
              <Menu className="h-5 w-5" />
              <span className="mt-1 text-[11px] font-medium leading-tight">{tt('shell.more', 'More')}</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  )
}

export default AppLayout


