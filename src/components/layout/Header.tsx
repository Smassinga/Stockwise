// src/components/layout/Header.tsx
import { useEffect, useRef, useState } from 'react'
import { Menu, Search, LogOut } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { NotificationCenter } from '../notifications/NotificationCenter'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../hooks/useOrg'
import ThemeToggle from '../ThemeToggle'
import CompanySwitcher from '../CompanySwitcher'

interface User {
  id: string
  email: string
  name: string
}

interface HeaderProps {
  onToggleSidebar?: () => void
  onMenuClick?: () => void
  user: User
  isMobile: boolean
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

export function Header({ onToggleSidebar, onMenuClick, user, isMobile }: HeaderProps) {
  const initial =
    (user && typeof user.name === 'string' && user.name.length > 0)
      ? user.name.charAt(0).toUpperCase()
      : (user && user.email ? user.email.charAt(0).toUpperCase() : '?')

  const { logout } = useAuth() as any
  const { companyName, myRole } = useOrg()
  const roleLine = `${companyName ?? 'Company'}${myRole ? ` · ${myRole}` : ''}`

  const [open, setOpen] = useState(false)
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false))

  return (
    <header className="h-16 border-b bg-card flex items-center justify-between px-6">
      {/* Left side: menu + search */}
      <div className="flex items-center space-x-4">
        {isMobile ? (
          <Button variant="ghost" size="sm" onClick={onMenuClick} aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            <Menu className="w-5 h-5" />
          </Button>
        )}

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search items, SKU, barcode..." className="pl-10 w-64" />
        </div>
      </div>

      {/* Right side: theme, notifications, company switcher, user */}
      <div className="flex items-center space-x-2 sm:space-x-4">
        <ThemeToggle />
        <NotificationCenter />

        {/* Desktop company switcher */}
        <CompanySwitcher className="hidden md:block" />

        <div className="flex items-center space-x-2">
          {/* Mobile avatar bubble (no dropdown on very small screens) */}
          <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center md:hidden">
            <span className="text-sm font-medium">{initial}</span>
          </div>

          {/* Desktop: name + company·role + avatar dropdown */}
          <div className="hidden md:flex items-center space-x-2" ref={ref}>
            <div className="text-right">
              <p className="text-sm font-medium">{user.name ?? user.email ?? 'Unknown'}</p>
              <p className="text-xs text-muted-foreground">{roleLine}</p>
            </div>
            <button
              className="h-9 w-9 rounded-full bg-primary/10 text-sm font-semibold flex items-center justify-center hover:bg-primary/20 transition"
              onClick={() => setOpen(v => !v)}
              aria-label="User menu"
            >
              {initial}
            </button>
            {open && (
              <div className="absolute right-6 top-14 w-44 rounded-md border bg-popover text-popover-foreground shadow-md">
                <div className="p-1">
                  <button
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm hover:bg-accent"
                    onClick={() => { setOpen(false); (logout as any)?.() }}
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
