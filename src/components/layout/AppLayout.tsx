// src/components/layout/AppLayout.tsx
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  ClipboardList,
  LogOut,
  Menu,
  Package,
  Search,
  UserRound,
  X,
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
import {
  isNavigationItemActive,
  isOrdersWorkspaceActive,
  navigationDefinitions,
  navigationGroups,
  type NavigationDefinition,
  type NavigationGroupId,
} from './navigation'

type Props = { user: AppUser; children: ReactNode }

type NavItem = NavigationDefinition & {
  label: string
  description?: string
}

type NavSection = {
  id: NavigationGroupId
  label: string
  items: NavItem[]
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
    <form
      onSubmit={onSubmit}
      role="search"
      className={cn(
        'group relative flex h-12 items-center overflow-hidden rounded-[1.25rem] border border-border/60 bg-card/76 shadow-[0_22px_40px_-34px_hsl(var(--foreground)/0.28)] transition-[border-color,box-shadow,background-color] focus-within:border-primary/35 focus-within:bg-background/94 focus-within:shadow-[0_26px_46px_-34px_hsl(var(--primary)/0.35)]',
        className,
      )}
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/90" />
      <Input
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full rounded-none border-0 bg-transparent pl-11 pr-4 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
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
  const drawerRef = useRef<HTMLElement>(null)
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const drawerWasOpenRef = useRef(false)
  const { logout } = useAuth()
  const { companyName, myRole } = useOrg()
  const { t } = useI18n()
  const tt = useCallback(
    (key: string, fallback: string, vars?: Record<string, string | number>) =>
      withI18nFallback(t, key, fallback, vars),
    [t],
  )
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
    const fallback = String(myRole)
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
    return tt(`users.roles.${String(myRole).toLowerCase()}`, fallback)
  }, [myRole, tt])

  const nav = useMemo(() => {
    const canManage = hasRole(myRole, [...CanManageUsers])
    return navigationDefinitions
      .filter((item) => !item.requiresUserManagement || canManage)
      .filter((item) => !item.requiresPlatformAdmin || isPlatformAdmin)
      .map((item) => ({
        ...item,
        label: tt(item.labelKey, item.fallbackLabel),
        description: item.descriptionKey && item.fallbackDescription
          ? tt(item.descriptionKey, item.fallbackDescription)
          : undefined,
      }))
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

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (event.shiftKey && (document.activeElement === first || !drawerRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    setOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)')
    const closeAtDesktop = () => {
      if (desktop.matches) setOpen(false)
    }
    closeAtDesktop()
    desktop.addEventListener('change', closeAtDesktop)
    return () => desktop.removeEventListener('change', closeAtDesktop)
  }, [])

  useEffect(() => {
    if (drawerWasOpenRef.current && !open) {
      window.requestAnimationFrame(() => drawerTriggerRef.current?.focus())
    }
    drawerWasOpenRef.current = open
  }, [open])

  const navSections = useMemo<NavSection[]>(
    () => navigationGroups
      .map((group) => ({
        id: group.id,
        label: tt(group.labelKey, group.fallbackLabel),
        items: nav.filter((item) => item.group === group.id),
      }))
      .filter((section) => section.items.length > 0),
    [nav, tt]
  )

  const isActive = useCallback(
    (item: Pick<NavigationDefinition, 'id' | 'to'>) =>
      isNavigationItemActive(item, location.pathname, location.search),
    [location.pathname, location.search],
  )

  const NavLink = ({ item, mobile = false }: { item: NavItem; mobile?: boolean }) => {
    const Icon = item.icon
    const active = isActive(item)
    return (
      <Link
        to={item.to}
        onClick={() => setOpen(false)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group/nav relative flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-[background-color,border-color,color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
          active
            ? 'border-sidebar-primary/25 bg-sidebar-primary text-sidebar-primary-foreground font-semibold shadow-[0_16px_30px_-22px_hsl(var(--sidebar-primary)/0.72)] before:absolute before:bottom-2 before:left-0 before:top-2 before:w-1 before:rounded-r-full before:bg-sidebar-primary-foreground/85'
            : 'border-transparent font-medium text-sidebar-foreground/74 hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
        )}
      >
        <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{item.label}</span>
          {mobile && item.description ? (
            <span className={cn('mt-0.5 block text-xs leading-snug', active ? 'text-sidebar-primary-foreground/78' : 'text-sidebar-foreground/55')}>
              {item.description}
            </span>
          ) : null}
        </span>
      </Link>
    )
  }

  const sidebar = useMemo(
    () => (
      <aside className="hidden text-sidebar-foreground md:flex md:w-[17.5rem] md:flex-col md:border-r md:border-sidebar-border md:bg-sidebar xl:w-[18.5rem] 2xl:w-[19rem]">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5">
          <BrandLockup compact subtitle="" />
          <div className="ml-2 shrink-0 overflow-visible">
            <ThemeToggle />
          </div>
        </div>

        <nav
          className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 xl:px-5"
          aria-label={tt('shell.navigation.primary', 'Primary navigation')}
        >
          {navSections.map((section) => (
            <section
              key={section.id}
              aria-labelledby={`desktop-nav-${section.id}`}
              className={cn('space-y-1.5', section.id === 'platform' && 'border-t border-sidebar-border pt-5')}
            >
              <h2 id={`desktop-nav-${section.id}`} className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/55">
                {section.label}
              </h2>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavLink key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </nav>

        <div className="space-y-3 border-t border-sidebar-border p-4">
          <div className="space-y-1.5">
            <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/55">
              {tt('shell.context.currentCompany', 'Current company')}
            </div>
            <CompanySwitcher />
          </div>
          <div className="rounded-[1.35rem] border border-sidebar-border bg-sidebar-accent/55 px-3.5 py-3.5 shadow-[0_14px_32px_-28px_hsl(0_0%_0%/0.6)]">
            <div className="truncate text-[11px] uppercase tracking-[0.14em] text-sidebar-foreground/55">
              {tt('shell.context.currentUser', 'Current user')}
            </div>
            <div className="mt-1 truncate text-sm font-medium" title={displayName}>{displayName}</div>
            <div className="text-xs text-sidebar-foreground/60">{displayRole}</div>
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
    [displayName, displayRole, isPlatformAdmin, isActive, logout, navSections, t, tt]
  )

  const handleSearch = (e: FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return
    // Navigate to search results page with query parameter
    navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`)
  }

  const initial = (displayName || 'A').charAt(0).toUpperCase()
  const mobilePrimaryNav = useMemo(() => {
    const dashboard = nav.find((item) => item.id === 'dashboard')
    const pointOfSale = nav.find((item) => item.id === 'pointOfSale')
    const entries = [
      dashboard && {
        id: dashboard.id,
        label: tt('shell.mobile.dashboard', 'Dashboard'),
        accessibleLabel: dashboard.label,
        to: dashboard.to,
        icon: dashboard.icon,
        active: isActive(dashboard),
      },
      pointOfSale && {
        id: pointOfSale.id,
        label: tt('shell.mobile.pointOfSale', 'POS'),
        accessibleLabel: pointOfSale.label,
        to: pointOfSale.to,
        icon: pointOfSale.icon,
        active: isActive(pointOfSale),
      },
      {
        id: 'orders',
        label: tt('shell.mobile.orders', 'Orders'),
        accessibleLabel: tt('shell.mobile.ordersWorkspace', 'Sales and purchase orders'),
        to: '/orders?tab=sales',
        icon: ClipboardList,
        active: isOrdersWorkspaceActive(location.pathname),
      },
      {
        id: 'stock',
        label: tt('shell.mobile.stock', 'Stock'),
        accessibleLabel: tt('shell.mobile.stockWorkspace', 'Items and stock'),
        to: '/items',
        icon: Package,
        active: location.pathname === '/items',
      },
    ]
    return entries.filter((item): item is NonNullable<typeof item> => Boolean(item))
  }, [isActive, location.pathname, nav, tt])
  const mobileShowsMoreActive = useMemo(
    () => !mobilePrimaryNav.some((item) => item.active),
    [mobilePrimaryNav],
  )

  return (
    <div className="flex min-h-[100dvh] overflow-x-clip bg-app-background">
      {sidebar}

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/54 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar */}
      <aside
        ref={drawerRef}
        id="mobile-navigation-drawer"
        role="dialog"
        aria-modal={open || undefined}
        aria-labelledby="mobile-navigation-title"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-[100dvh] max-h-[100dvh] w-[88vw] max-w-[24rem] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar pb-[var(--app-safe-bottom)] pt-[var(--app-safe-top)] text-sidebar-foreground shadow-[0_24px_60px_-30px_hsl(0_0%_0%/0.72)] transition-transform duration-300 ease-in-out md:hidden',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <h2 id="mobile-navigation-title" className="sr-only">
          {tt('shell.navigation.mobile', 'Mobile navigation')}
        </h2>
        <div className="flex h-16 shrink-0 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <BrandLockup compact subtitle="" />
            <div className="ml-2 shrink-0 overflow-visible">
              <ThemeToggle compact />
            </div>
          </div>
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            aria-label={tt('shell.navigation.close', 'Close navigation')}
            className="h-9 w-9"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <div className="space-y-1.5 pb-4">
            <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/55">
              {tt('shell.context.currentCompany', 'Current company')}
            </div>
            <CompanySwitcher />
          </div>
          <nav className="space-y-5 py-2" aria-label={tt('shell.navigation.mobileRoutes', 'Mobile routes')}>
            {navSections.map((section) => (
              <section
                key={section.id}
                aria-labelledby={`mobile-nav-${section.id}`}
                className={cn('space-y-1.5', section.id === 'platform' && 'border-t border-sidebar-border pt-5')}
              >
                <h3 id={`mobile-nav-${section.id}`} className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/55">
                  {section.label}
                </h3>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <NavLink key={item.id} item={item} mobile />
                  ))}
                </div>
              </section>
            ))}
          </nav>
          <div className="mt-4 border-t border-sidebar-border pt-4">
            <div className="rounded-[1.35rem] border border-sidebar-border bg-sidebar-accent/55 px-3.5 py-3.5 shadow-[0_14px_32px_-28px_hsl(0_0%_0%/0.6)]">
              <div className="truncate text-[11px] uppercase tracking-[0.14em] text-sidebar-foreground/55">
                {tt('shell.context.currentUser', 'Current user')}
              </div>
              <div className="mt-1 truncate text-sm font-medium" title={displayName}>{displayName}</div>
              <div className="text-xs text-sidebar-foreground/60">{displayRole}</div>
              {isPlatformAdmin ? (
                <div className="mt-2 inline-flex rounded-full border border-primary/20 bg-primary/8 px-2 py-1 text-[11px] font-medium text-primary">
                  {tt('platform.adminBadge', 'Platform admin')}
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <LocaleToggle />
              <Button asChild variant="ghost" size="sm" className="min-h-10 min-w-0 flex-1 justify-start">
                <Link to="/profile" onClick={() => setOpen(false)}>
                  <UserRound className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t('common.profile')}
                </Link>
              </Button>
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
        </div>
      </aside>

      <div
        className="flex min-h-[100dvh] min-w-0 flex-1 flex-col"
        aria-hidden={open || undefined}
        inert={open}
      >
        <header className="sticky top-0 z-30 flex h-[calc(var(--app-shell-mobile-header)+var(--app-safe-top))] items-center gap-2.5 border-b border-border/80 bg-background/92 pl-[max(1rem,var(--app-safe-left))] pr-[max(1rem,var(--app-safe-right))] pt-[var(--app-safe-top)] shadow-[0_1px_0_hsl(var(--border)/0.65)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/78 md:h-16 md:gap-3 md:px-6 md:pt-0 xl:gap-4 xl:px-8 2xl:px-10">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 md:hidden"
            onClick={(event) => {
              drawerTriggerRef.current = event.currentTarget
              setOpen(true)
            }}
            aria-label={tt('shell.navigation.open', 'Open navigation')}
            aria-expanded={open}
            aria-controls="mobile-navigation-drawer"
          >
            <Menu className="h-5 w-5" />
          </Button>
          
          {/* Mobile search form */}
          <div className="min-w-0 flex-1 md:hidden">
            <SearchBar
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={setSearchQuery}
              onSubmit={handleSearch}
              className="h-11"
            />
          </div>
          
          {/* Desktop search form */}
          <div className="ml-1 hidden min-w-0 flex-1 md:flex">
            <SearchBar
              className="w-full max-w-[30rem] xl:max-w-[38rem] 2xl:max-w-[42rem]"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={setSearchQuery}
              onSubmit={handleSearch}
            />
          </div>
          
          <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-2.5">
            <LocaleToggle className="hidden md:inline-flex" />
            <NotificationCenter />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="hidden h-10 items-center gap-2 rounded-xl border-border/70 bg-background/80 px-2.5 md:inline-flex"
                  aria-label={tt('shell.account.userMenu', 'User menu')}
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
                  <UserRound className="h-4 w-4" />
                  {t('common.profile')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout?.()}>
                  <LogOut className="h-4 w-4" />
                  {t('common.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="app-main-content min-w-0 flex-1 overflow-x-hidden pl-[max(1rem,var(--app-safe-left))] pr-[max(1rem,var(--app-safe-right))] pb-[calc(var(--app-shell-mobile-dock)+var(--app-safe-bottom)+1.25rem)] md:px-6 md:pb-10 xl:px-8 2xl:px-10">
          {children}
        </main>

        <nav
          className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-background via-background/90 to-transparent pl-[max(0.75rem,var(--app-safe-left))] pr-[max(0.75rem,var(--app-safe-right))] pb-[calc(0.9rem+var(--app-safe-bottom))] pt-3 md:hidden"
          aria-label={tt('shell.navigation.bottom', 'Primary mobile navigation')}
        >
          <div className="pointer-events-auto mx-auto max-w-[30rem] rounded-[1.9rem] border border-border/80 bg-card/98 p-2.5 shadow-[0_34px_70px_-34px_hsl(var(--foreground)/0.5)] ring-1 ring-background/75 backdrop-blur-2xl">
          <div className="grid grid-cols-5 gap-2">
            {mobilePrimaryNav.map((item) => {
              const Icon = item.icon
              const active = item.active
              return (
                <Link
                  key={item.id}
                  to={item.to}
                  aria-label={item.accessibleLabel}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex min-h-[4.75rem] min-w-0 flex-col items-center justify-center rounded-[1.25rem] px-1.5 text-center transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    active
                      ? 'bg-primary text-primary-foreground font-semibold shadow-[0_16px_28px_-22px_hsl(var(--primary)/0.92)] after:absolute after:bottom-1.5 after:h-1 after:w-5 after:rounded-full after:bg-primary-foreground/85'
                      : 'text-foreground/70 hover:bg-accent/45 hover:text-foreground',
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span className="mt-1 max-w-full text-[11px] font-semibold leading-tight">{item.label}</span>
                </Link>
              )
            })}
            <button
              type="button"
              className={cn(
                'relative flex min-h-[4.75rem] min-w-0 flex-col items-center justify-center rounded-[1.25rem] px-1.5 text-center transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                mobileShowsMoreActive
                  ? 'bg-primary text-primary-foreground font-semibold shadow-[0_16px_28px_-22px_hsl(var(--primary)/0.92)] after:absolute after:bottom-1.5 after:h-1 after:w-5 after:rounded-full after:bg-primary-foreground/85'
                  : 'text-foreground/70 hover:bg-accent/45 hover:text-foreground',
              )}
              onClick={(event) => {
                drawerTriggerRef.current = event.currentTarget
                setOpen(true)
              }}
              aria-label={tt('shell.more', 'More')}
              aria-expanded={open}
              aria-controls="mobile-navigation-drawer"
              aria-pressed={mobileShowsMoreActive}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
              <span className="mt-1 text-[11px] font-semibold leading-tight">{tt('shell.more', 'More')}</span>
            </button>
          </div>
          </div>
        </nav>
      </div>
    </div>
  )
}

export default AppLayout


