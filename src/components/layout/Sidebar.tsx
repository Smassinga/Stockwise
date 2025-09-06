// src/components/layout/Sidebar.tsx
import { Link } from 'react-router-dom'
import {
  LayoutDashboard,
  Package,
  ArrowUpDown,
  FileText,
  Settings,
  Warehouse,
  Users as UsersIcon,
  X,
  ChevronLeft,
  ChevronRight,
  ShoppingCart,
  Coins,
  Users,         // for Customers
  Building2,     // for Suppliers
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../hooks/useOrg'
import { hasRole, CanManageUsers } from '../../lib/roles'

interface User {
  id: string
  email: string
  name: string
}

interface SidebarProps {
  isCollapsed?: boolean
  user: User
  currentPath: string
  onClose?: () => void
  isMobile?: boolean
  onCollapseToggle?: () => void
}

type NavItem = {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  requiresPrivileged?: boolean
}

const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Items', href: '/items', icon: Package },
  { name: 'Movements', href: '/movements', icon: ArrowUpDown },
  { name: 'Reports', href: '/reports', icon: FileText },
  { name: 'Warehouses', href: '/warehouses', icon: Warehouse },
  { name: 'Orders', href: '/orders', icon: ShoppingCart },
  { name: 'Currency', href: '/currency', icon: Coins },
  { name: 'Customers', href: '/customers', icon: Users },
  { name: 'Suppliers', href: '/suppliers', icon: Building2 },
  // Admin
  { name: 'Users', href: '/users', icon: UsersIcon, requiresPrivileged: true },
  { name: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar({
  isCollapsed = false,
  user,
  currentPath,
  onClose,
  isMobile = false,
  onCollapseToggle,
}: SidebarProps) {
  const auth: any = useAuth()
  const maybeLogout: (() => void) | undefined = auth?.logout
  const { companyName, myRole } = useOrg()
  const canManageUsers = hasRole(myRole, CanManageUsers)

  const initial =
    user && typeof user.name === 'string' && user.name.length > 0
      ? user.name.charAt(0).toUpperCase()
      : user && user.email
      ? user.email.charAt(0).toUpperCase()
      : '?'

  const filteredNavigation = navigation.filter((item) =>
    item.requiresPrivileged ? canManageUsers : true
  )

  const handleLogout = () => {
    maybeLogout?.()
  }

  const isActivePath = (href: string) => {
    if (href === '/') return currentPath === '/'
    return currentPath === href || currentPath.startsWith(href + '/')
  }

  return (
    <div
      className={cn(
        'bg-card border-r flex flex-col h-full transition-all duration-300',
        isCollapsed && !isMobile ? 'w-16' : 'w-64'
      )}
    >
      {/* Header */}
      <div className="border-b flex-shrink-0 p-6">
        <div className="flex items<center justify-between">
          {(!isCollapsed || isMobile) && (
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Package className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-semibold text-lg">StockWise</span>
            </div>
          )}

          {isMobile && onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close menu">
              <X className="w-4 h-4" />
            </Button>
          )}

          {!isMobile && !isCollapsed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCollapseToggle}
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          )}
          {!isMobile && isCollapsed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCollapseToggle}
              aria-label="Expand sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {filteredNavigation.map((item) => {
            const Icon = item.icon as any
            const isActive = isActivePath(item.href)

            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={isMobile ? onClose : undefined}
                className={cn(
                  'flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  isCollapsed && !isMobile && 'justify-center space-x-0'
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {(!isCollapsed || isMobile) && <span>{item.name}</span>}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* User section */}
      <div className="border-t flex-shrink-0 p-4">
        <div
          className={cn(
            'flex items-center space-x-3',
            isCollapsed && !isMobile && 'justify-center space-x-0'
          )}
        >
          <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
            <span className="text-sm font-medium">{initial}</span>
          </div>
          {(!isCollapsed || isMobile) && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {user.name ?? user.email ?? 'Unknown'}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {companyName ? `${companyName}` : 'Company'}{myRole ? ` · ${myRole}` : ''}
              </p>
            </div>
          )}
        </div>

        {(!isCollapsed || isMobile) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="w-full mt-2 justify-start"
          >
            Sign Out
          </Button>
        )}
      </div>
    </div>
  )
}
