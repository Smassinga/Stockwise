import { useEffect, useState } from 'react'
import { db } from '../../lib/db'
import { Bell } from 'lucide-react'

type LowStockAlert = {
  id: string
  itemId: string
  currentQty: number
  threshold?: number | null
  minStock?: number | null
  status: string
  createdAt: string
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState<LowStockAlert[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        setLoading(true)
        // no userId in schema — only filter by status
        const rows = await db.lowStockAlerts.list({
          where: { status: 'active' as any },
          orderBy: { createdAt: 'asc' },
          limit: 20,
        })
        setAlerts(rows || [])
      } catch (e) {
        // silent fail — don’t spam console
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const count = alerts.length

  return (
    <div className="relative">
      <button
        className="relative inline-flex items-center justify-center w-10 h-10 rounded-md hover:bg-muted"
        onClick={() => setOpen(v => !v)}
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center text-xs px-1.5 py-0.5 rounded-full bg-red-600 text-white">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-md border bg-card shadow-lg z-50">
          <div className="p-3 border-b font-medium">Notifications</div>
          <div className="max-h-80 overflow-auto">
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : count === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No alerts.</div>
            ) : (
              <ul className="divide-y">
                {alerts.map(a => (
                  <li key={a.id} className="p-3 text-sm">
                    <div className="font-medium">Low stock alert</div>
                    <div className="text-muted-foreground">
                      Item: {a.itemId} • Qty: {a.currentQty}{' '}
                      {typeof a.threshold === 'number' ? `• Min: ${a.threshold}` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(a.createdAt).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default NotificationCenter
