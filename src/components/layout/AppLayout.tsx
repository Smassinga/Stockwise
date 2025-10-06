// src/components/layout/AppLayout.tsx
import { ReactNode, useEffect, useRef, useState, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
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
  Wallet,          // Cash icon
  Banknote,        // Banks icon
  Ruler,           // UoM
  ClipboardList,   // Stock Levels
  Monitor,         // Responsive demo
  X
} from 'lucide-react'
import { AppUser, useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'
import { useOrg } from '../../hooks/useOrg'
import { hasRole, CanManageUsers } from '../../lib/roles'
import ThemeToggle from '../ThemeToggle'
import { NotificationCenter } from '../notifications/NotificationCenter'
import CompanySwitcher from '../CompanySwitcher'
import { useI18n } from '../../lib/i18n'
// Note: useIsMobile is imported but not currently used in this component
// It's kept for potential future use or debugging
import { useIsMobile } from '../../hooks/use-mobile'

type Props = { user: AppUser; children: ReactNode }

type NavItem = {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
}

function buildNavLabels(t: (k: string, v?: any) => string): NavItem[] {
  return [
    { label: t('nav.dashboard'),    to: '/dashboard',    icon: LayoutGrid },
    { label: t('nav.items'),        to: '/items',        icon: Package },
    { label: t('nav.bom'),          to: '/bom',          icon: Layers },
    { label: t('nav.movements'),    to: '/movements',    icon: ArrowLeftRight },
    { label: t('nav.transactions'), to: '/transactions', icon: Receipt },
    { label: t('nav.cash'),         to: '/cash',         icon: Wallet },
    { label: t('nav.banks'),        to: '/banks',        icon: Banknote },
    { label: t('nav.orders'),       to: '/orders',       icon: ShoppingCart },
    { label: t('nav.reports'),      to: '/reports',      icon: BarChart3 },
    { label: t('nav.stockLevels'),  to: '/stock-levels', icon: ClipboardList },
    { label: t('nav.warehouses'),   to: '/warehouses',   icon: Boxes },
    { label: t('nav.users'),        to: '/users',        icon: UsersIcon },
    { label: t('nav.customers'),    to: '/customers',    icon: Users },
    { label: t('nav.suppliers'),    to: '/suppliers',    icon: Truck },
    { label: t('nav.currency'),     to: '/currency',     icon: Coins },
    { label: t('nav.uom'),          to: '/uom',          icon: Ruler },
    { label: 'Responsive Demo',     to: '/responsive-demo', icon: Monitor },
    { label: t('nav.settings'),     to: '/settings',     icon: SettingsIcon },
  ]
}

function useClickOutside<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose])
  return ref
}

export function AppLayout({ user, children }: Props) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const { logout } = useAuth() as any
  const { companyName, myRole } = useOrg()
  const { t } = useI18n()
  // Note: useIsMobile is imported but not currently used in this component
  // It's kept for potential future use or debugging

  const nav = useMemo(() => {
    const canManage = hasRole(myRole, CanManageUsers)
    const base = buildNavLabels(t)
    return base.filter(item => !(item.to === '/users' && !canManage))
  }, [myRole, t])

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
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          active
            ? 'bg-primary text-primary-foreground'
            : 'text-foreground/80 hover:bg-accent hover:text-foreground'
        )}
      >
        <Icon className="h-5 w-5 flex-shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    )
  }

  const sidebar = useMemo(
    () => (
      <aside className="hidden md:flex md:w-64 md:flex-col md:border-r">
        <div className="flex h-16 items-center gap-2 px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" />
              <path d="M12 22V12" />
            </svg>
          </div>
          <div className="text-lg font-bold truncate">StockWise</div>
          <div className="ml-2 shrink-0">
            <ThemeToggle />
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {nav.map((item) => (
            <NavLink key={item.to} item={item} />
          ))}
        </nav>

        <div className="border-t p-3">
          <CompanySwitcher className="mb-2" />
          {companyName && <div className="text-xs text-muted-foreground truncate">{companyName}</div>}
          <div className="mt-1 text-sm font-medium truncate">{user.name || user.email}</div>
          <div className="text-xs text-muted-foreground">{myRole ?? '—'}</div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start"
            onClick={() => logout?.()}
          >
            <LogOut className="mr-2 h-4 w-4" />
            {t('common.signOut')}
          </Button>
        </div>
      </aside>
    ),
    [user, location.pathname, logout, nav, companyName, myRole]
  )

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useClickOutside<HTMLDivElement>(() => setMenuOpen(false))
  const initial = (user.name || user.email || '?').charAt(0).toUpperCase()

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
          'fixed inset-y-0 left-0 z-50 w-64 border-r bg-background transition-transform duration-300 ease-in-out md:hidden',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                <path d="m3.3 7 8.7 5 8.7-5" />
                <path d="M12 22V12" />
              </svg>
            </div>
            <div className="text-lg font-bold">StockWise</div>
            <div className="ml-2 shrink-0">
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
        <nav className="space-y-1 px-3 py-2">
          {nav.map((item) => (
            <NavLink key={item.to} item={item} />
          ))}
        </nav>
        <div className="mt-auto border-t p-3">
          {companyName && <div className="text-xs text-muted-foreground truncate">{companyName}</div>}
          <div className="mt-1 text-sm font-medium truncate">{user.name || user.email}</div>
          <div className="text-xs text-muted-foreground">{myRole ?? '—'}</div>
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background px-4">
          <Button 
            variant="ghost" 
            size="icon" 
            className="md:hidden h-9 w-9" 
            onClick={() => setOpen(true)} 
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="ml-1 flex-1 md:hidden">
            <Input 
              placeholder={t('common.searchPlaceholder')} 
              className="w-full" 
            />
          </div>
          <div className="ml-1 hidden flex-1 md:flex">
            <Input 
              placeholder={t('common.searchPlaceholder')} 
              className="max-w-xl" 
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <NotificationCenter />
            <CompanySwitcher className="hidden md:block" />
            <div className="hidden text-right md:block">
              {companyName && <div className="text-xs text-muted-foreground truncate">{companyName}</div>}
              <div className="text-sm font-semibold leading-tight truncate">{user.name || user.email}</div>
              <div className="text-xs text-muted-foreground">{myRole ?? '—'}</div>
            </div>

            <div className="relative ml-2 hidden md:block" ref={menuRef}>
              <button
                className="h-9 w-9 rounded-full bg-primary/10 text-sm font-semibold flex items-center justify-center hover:bg-primary/20 transition min-h-[44px] min-w-[44px]"
                onClick={() => setMenuOpen(v => !v)}
                aria-label="User menu"
              >
                {initial}
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-44 rounded-md border bg-popover text-popover-foreground shadow-md">
                  <div className="p-1">
                    <button
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm hover:bg-accent min-h-[44px]"
                      onClick={() => { setMenuOpen(false); logout?.() }}
                    >
                      <LogOut className="h-4 w-4" />
                      {t('common.signOut')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}

export default AppLayout