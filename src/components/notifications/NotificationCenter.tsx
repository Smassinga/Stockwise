import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, CheckCheck, Loader2, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../hooks/useOrg'
import { Button } from '../ui/button'
import { useI18n } from '../../lib/i18n'

type AnyRow = Record<string, any>

type Notif = {
  id: string
  title: string
  body: string
  createdAt: string
  readAt: string | null
  actionUrl?: string | null
}

const pick = (obj: AnyRow | null | undefined, variants: string[], fallback?: any) => {
  if (!obj) return fallback
  for (const k of variants) if (obj[k] !== undefined && obj[k] !== null) return obj[k]
  return fallback
}
const ts = (r: AnyRow) =>
  pick(r, ['created_at', 'createdAt', 'inserted_at', 'insertedAt', 'updated_at', 'updatedAt'], null)

function mapRow(r: AnyRow): Notif {
  return {
    id: String(r.id ?? r.uuid ?? r.pk ?? Math.random().toString(36).slice(2)),
    title: String(pick(r, ['title', 'subject', 'header', 'name'], '(no title)') ?? '(no title)'),
    body: String(pick(r, ['body', 'message', 'content', 'text'], '') ?? ''),
    createdAt: String(ts(r) ?? new Date().toISOString()),
    readAt: pick(r, ['read_at', 'readAt'], null) ? String(pick(r, ['read_at', 'readAt'])) : null,
    actionUrl: pick(r, ['action_url', 'url', 'href'], null),
  }
}

export function NotificationCenter() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const { user } = useAuth() as any
  const userId: string | null = user?.id ?? null
  const { companyId } = useOrg()

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<Notif[]>([])
  const [subscribing, setSubscribing] = useState(false)

  const unreadCount = useMemo(() => rows.filter(r => !r.readAt).length, [rows])

  async function fetchLatest() {
    if (!companyId) { setRows([]); return }
    try {
      setLoading(true)
      let q = supabase
        .from('notifications')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (userId) q = q.or(`user_id.eq.${userId},user_id.is.null`)
      const { data, error } = await q
      if (error) throw error
      setRows((data ?? []).map(mapRow))
    } catch (e) {
      console.warn('Notification fetch failed:', e)
    } finally {
      setLoading(false)
    }
  }

  async function markAllRead() {
    if (!companyId) return
    try {
      const now = new Date().toISOString()
      let upd = supabase
        .from('notifications')
        .update({ read_at: now })
        .eq('company_id', companyId)
        .is('read_at', null)
      if (userId) upd = upd.or(`user_id.eq.${userId},user_id.is.null`)
      const { error } = await upd
      if (error) throw error
      setRows(prev => prev.map(r => (r.readAt ? r : { ...r, readAt: now })))
    } catch (e) {
      console.warn('Mark all read failed:', e)
    }
  }

  // Realtime: rely on payload.new (no `.record`)
  useEffect(() => {
    if (!companyId) return
    setSubscribing(true)
    const channel = supabase
      .channel('public:notifications')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `company_id=eq.${companyId}` },
        (payload) => {
          const rec = (payload as any).new as AnyRow | undefined
          if (!rec) return
          const recCompany = pick(rec, ['company_id', 'companyId'], null)
          if (String(recCompany) !== String(companyId)) return
          const recUser = pick(rec, ['user_id', 'userId'], null)
          if (userId && recUser && String(recUser) !== String(userId)) return
          const mapped = mapRow(rec)
          setRows(prev => {
            const idx = prev.findIndex(x => x.id === mapped.id)
            if (idx >= 0) { const copy = prev.slice(); copy[idx] = mapped; return copy }
            return [mapped, ...prev].slice(0, 50)
          })
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setSubscribing(false)
      })
    return () => { try { supabase.removeChannel(channel) } catch {} }
  }, [companyId, userId])

  useEffect(() => {
    fetchLatest()
    const t = setInterval(fetchLatest, 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, userId])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const inPanel = !!target?.closest('[data-role="notif-panel"]')
      const inBtn = !!target?.closest('[data-role="notif-btn"]')
      if (!inPanel && !inBtn) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <>
      <Button
        ref={btnRef}
        variant="ghost"
        size="sm"
        data-role="notif-btn"
        aria-label={t("notifications.title")}
        onClick={() => { setOpen(v => !v); if (!rows.length) void fetchLatest() }}
        className="relative"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-600 text-white text-[10px] leading-none px-1.5 py-1">
            {unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          data-role="notif-panel"
          className="fixed right-4 top-16 w-96 max-w-[95vw] rounded-md border bg-popover text-popover-foreground shadow-lg z-[99999]"
          role="dialog"
          aria-label={t("notifications.title")}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <div className="text-sm font-medium">{t("notifications.title")}</div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={fetchLatest} title={t("common.refresh")}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={markAllRead} title={t("notifications.markAllRead")}>
                <CheckCheck className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-auto">
            {rows.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">{t("notifications.noNotifications")}</div>
            )}
            {rows.map((n) => (
              <div key={n.id} className="px-3 py-2 border-b last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{n.title || '(no title)'}</div>
                    {n.body && <div className="text-xs text-muted-foreground whitespace-pre-wrap">{n.body}</div>}
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {!n.readAt && <span className="mt-0.5 h-2 w-2 rounded-full bg-blue-600 shrink-0" />}
                </div>
                {n.actionUrl && (
                  <div className="mt-2">
                    <a href={n.actionUrl} className="text-xs underline text-primary" target="_blank" rel="noreferrer">
                      {t("notifications.open")}
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="px-3 py-2 text-[11px] text-muted-foreground border-t flex items-center justify-between">
            <span>{t("notifications.realtime.connecting")}: {subscribing ? t("notifications.realtime.connecting") : t("notifications.realtime.on")}</span>
            <span>{t("notifications.showingLatest", { count: rows.length })}</span>
          </div>
        </div>
      )}
    </>
  )
}

export default NotificationCenter
