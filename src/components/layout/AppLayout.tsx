import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
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
  Bell,
  Menu,
  LogOut,
  Layers, // <-- added for BOM
} from 'lucide-react'
import { AppUser, useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'
import { useOrg } from '../../hooks/useOrg'
import { hasRole, CanManageUsers } from '../../lib/roles'

type Props = { user: AppUser; children: ReactNode }

type NavItem = {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
}

const BASE_NAV: NavItem[] = [
  { label: 'Dashboard',  to: '/dashboard',  icon: LayoutGrid },
  { label: 'Items',      to: '/items',      icon: Package },
  { label: 'BOM',        to: '/bom',        icon: Layers },          // <-- added
  { label: 'Movements',  to: '/movements',  icon: ArrowLeftRight },
  { label: 'Orders',     to: '/orders',     icon: ShoppingCart },
  { label: 'Reports',    to: '/reports',    icon: BarChart3 },
  { label: 'Warehouses', to: '/warehouses', icon: Boxes },
  { label: 'Users',      to: '/users',      icon: UsersIcon }, // filtered by role
  { label: 'Customers',  to: '/customers',  icon: Users },
  { label: 'Suppliers',  to: '/suppliers',  icon: Truck },
  { label: 'Currency',   to: '/currency',   icon: Coins },
  { label: 'Settings',   to: '/settings',   icon: SettingsIcon },
]

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
  const { companyName, myRole } = useOrg()   // <-- FIX: was orgName

  // filter nav (Users = MANAGER+)
  const nav = useMemo(() => {
    const canManage = hasRole(myRole, CanManageUsers)
    return BASE_NAV.filter(item => !(item.to === '/users' && !canManage))
  }, [myRole])

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
        <Icon className="h-4 w-4" />
        {item.label}
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
          <div className="text-lg font-bold">StockWise</div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {nav.map((item) => (
            <NavLink key={item.to} item={item} />
          ))}
        </nav>
        <div className="border-t p-3">
          {companyName && <div className="text-xs text-muted-foreground truncate">{companyName}</div>} {/* <-- FIX */}
          <div className="mt-1 text-sm font-medium">{user.name || user.email}</div>
          <div className="text-xs text-muted-foreground">{myRole ?? '—'}</div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start"
            onClick={() => logout?.()}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>
    ),
    [user, location.pathname, logout, nav, companyName, myRole] // <-- FIX: companyName
  )

  // Header user menu
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useClickOutside<HTMLDivElement>(() => setMenuOpen(false))
  const initial = (user.name || user.email || '?').charAt(0).toUpperCase()

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      {sidebar}

      {/* Mobile overlay */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-background/70 backdrop-blur-sm md:hidden',
          open ? 'block' : 'hidden'
        )}
        onClick={() => setOpen(false)}
      />
      {/* Mobile slide-in sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 border-r bg-background transition-transform md:hidden',
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
          </div>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close menu">
            ✕
          </Button>
        </div>
        <nav className="space-y-1 px-3 py-2">
          {nav.map((item) => (
            <NavLink key={item.to} item={item} />
          ))}
        </nav>
        <div className="mt-auto border-t p-3">
          {companyName && <div className="text-xs text-muted-foreground truncate">{companyName}</div>} {/* <-- FIX */}
          <div className="mt-1 text-sm font-medium">{user.name || user.email}</div>
          <div className="text-xs text-muted-foreground">{myRole ?? '—'}</div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start"
            onClick={() => { setOpen(false); logout?.() }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-h-screen flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background px-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
          <div className="ml-1 hidden flex-1 md:flex">
            <Input placeholder="Search items, SKU, barcode..." className="max-w-xl" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell className="h-5 w-5" />
            </Button>

            <div className="hidden text-right md:block">
              {companyName && <div className="text-xs text-muted-foreground truncate">{companyName}</div>} {/* <-- FIX */}
              <div className="text-sm font-semibold leading-tight">{user.name || user.email}</div>
              <div className="text-xs text-muted-foreground">{myRole ?? '—'}</div>
            </div>

            {/* Avatar + dropdown */}
            <div className="relative ml-2 hidden md:block" ref={menuRef}>
              <button
                className="h-9 w-9 rounded-full bg-primary/10 text-sm font-semibold flex items-center justify-center hover:bg-primary/20 transition"
                onClick={() => setMenuOpen(v => !v)}
                aria-label="User menu"
              >
                {initial}
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-44 rounded-md border bg-popover text-popover-foreground shadow-md">
                  <div className="p-1">
                    <button
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm hover:bg-accent"
                      onClick={() => { setMenuOpen(false); logout?.() }}
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
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
