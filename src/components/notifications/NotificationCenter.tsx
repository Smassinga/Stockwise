// src/components/notifications/NotificationCenter.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, CheckCheck, Loader2, RefreshCw } from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, createAuthedChannel } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../hooks/useOrg'
import { useI18n } from '../../lib/i18n'
import { Button } from '../ui/button'

type AnyRow = Record<string, any>
type Notif = {
  id: string
  title: string
  body: string
  createdAt: string
  readAt: string | null
  url?: string | null
}

const NOTIFICATION_SELECT = 'id,title,body,created_at,read_at,url,user_id,company_id'
const NOTIFICATION_SELECT_FALLBACK = 'id,title,body,created_at,read_at,url'
const isDev = import.meta.env.DEV

const pick = (obj: AnyRow | null | undefined, variants: string[], fallback?: any) => {
  if (!obj) return fallback
  for (const k of variants) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k]
  }
  return fallback
}

const ts = (r: AnyRow) =>
  pick(r, ['created_at', 'createdAt', 'inserted_at', 'insertedAt', 'updated_at', 'updatedAt'], null)

function debugLog(...args: unknown[]) {
  if (isDev) console.log(...args)
}

function isUnknownColumnError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '42703'
}

function mapRow(r: AnyRow): Notif {
  return {
    id: String(r.id ?? r.uuid ?? r.pk ?? Math.random().toString(36).slice(2)),
    title: String(pick(r, ['title', 'subject', 'header', 'name'], '(no title)') ?? '(no title)'),
    body: String(pick(r, ['body', 'message', 'content', 'text'], '') ?? ''),
    createdAt: String(ts(r) ?? new Date().toISOString()),
    readAt: pick(r, ['read_at', 'readAt'], null) ? String(pick(r, ['read_at', 'readAt'])) : null,
    url: pick(r, ['url', 'action_url', 'href'], null),
  }
}

function mapRows(rows: AnyRow[] | null | undefined): Notif[] {
  const mapped: Notif[] = []
  for (const row of rows ?? []) {
    try {
      mapped.push(mapRow(row))
    } catch (error) {
      if (isDev) console.warn('[NotificationCenter] Failed to map notification row', { row, error })
    }
  }
  return mapped
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

  const chanRef = useRef<RealtimeChannel | null>(null)
  const activeCompanyRef = useRef<string | null>(null)
  const activeUserRef = useRef<string | null>(userId)
  const settingUpCompanyRef = useRef<string | null>(null)

  const unreadCount = useMemo(() => rows.filter(r => !r.readAt).length, [rows])

  useEffect(() => {
    activeUserRef.current = userId
  }, [userId])

  async function runNotificationQuery(selectClause: string, company: string, currentUserId: string | null) {
    let q = supabase
      .from('notifications')
      .select(selectClause)
      .eq('company_id', company)
      .order('created_at', { ascending: false })
      .limit(50)

    if (currentUserId) {
      q = q.or(`user_id.eq.${currentUserId},user_id.is.null`)
    }

    return q
  }

  async function fetchLatest() {
    if (!companyId) {
      setRows([])
      return
    }

    try {
      setLoading(true)

      let { data, error } = await runNotificationQuery(NOTIFICATION_SELECT, companyId, userId)
      if (error && isUnknownColumnError(error)) {
        const fallback = await runNotificationQuery(NOTIFICATION_SELECT_FALLBACK, companyId, userId)
        data = fallback.data
        error = fallback.error
      }

      if (error) throw error
      setRows(mapRows(data as AnyRow[] | null | undefined))
    } catch (e) {
      console.warn('[NotificationCenter] Notification fetch failed:', e)
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

      if (userId) {
        upd = upd.or(`user_id.eq.${userId},user_id.is.null`)
      }

      const { error } = await upd
      if (error) throw error
      setRows(prev => prev.map(r => (r.readAt ? r : { ...r, readAt: now })))
    } catch (e) {
      console.warn('[NotificationCenter] Mark all read failed:', e)
    }
  }

  useEffect(() => {
    if (!companyId) {
      debugLog('[NotificationCenter] No companyId, skipping subscription')
      setSubscribing(false)
      settingUpCompanyRef.current = null

      if (chanRef.current) {
        const channel = chanRef.current
        chanRef.current = null
        activeCompanyRef.current = null
        void supabase.removeChannel(channel).catch((error) => {
          if (isDev) console.warn('[NotificationCenter] Error removing channel without company context', error)
        })
      }

      return
    }

    if (chanRef.current && activeCompanyRef.current === companyId) {
      debugLog('[NotificationCenter] Channel already active for company', { companyId })
      return
    }

    if (settingUpCompanyRef.current === companyId) {
      debugLog('[NotificationCenter] Channel setup already in flight for company', { companyId })
      return
    }

    let disposed = false
    settingUpCompanyRef.current = companyId
    setSubscribing(true)

    ;(async () => {
      try {
        if (chanRef.current) {
          const previousChannel = chanRef.current
          const previousCompany = activeCompanyRef.current
          chanRef.current = null
          activeCompanyRef.current = null
          debugLog('[NotificationCenter] Removing previous channel', { prevCompany: previousCompany })
          await supabase.removeChannel(previousChannel)
        }

        debugLog('[NotificationCenter] Setting up realtime subscription for company', { companyId })
        const chan = await createAuthedChannel(`notifications:company:${companyId}`)

        if (disposed) {
          await supabase.removeChannel(chan)
          return
        }

        debugLog('[NotificationCenter] Channel created, setting up listener')

        chan
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'notifications', filter: `company_id=eq.${companyId}` },
            (payload) => {
              debugLog('[NotificationCenter] Received realtime payload', payload)
              const eventType = (payload as { eventType?: string }).eventType

              if (eventType === 'DELETE') {
                const deleted = (payload as { old?: AnyRow }).old
                const deletedId = deleted?.id ? String(deleted.id) : null
                if (deletedId) {
                  setRows(prev => prev.filter((row) => row.id !== deletedId))
                }
                return
              }

              const rec = (payload as { new?: AnyRow }).new
              if (!rec) return

              const currentCompanyId = activeCompanyRef.current
              if (currentCompanyId && String(rec.company_id ?? rec.companyId) !== String(currentCompanyId)) return

              const recUser = rec.user_id ?? rec.userId
              const currentUserId = activeUserRef.current
              if (currentUserId && recUser && String(recUser) !== String(currentUserId)) return

              const mapped = mapRow(rec)
              setRows(prev => {
                const idx = prev.findIndex(x => x.id === mapped.id)
                if (idx >= 0) {
                  const next = prev.slice()
                  next[idx] = mapped
                  return next
                }
                return [mapped, ...prev].slice(0, 50)
              })
            }
          )
          .subscribe((status) => {
            debugLog('[NotificationCenter] Subscription status changed', { status, companyId })
            if (disposed) return

            if (status === 'SUBSCRIBED') {
              setSubscribing(false)
              return
            }

            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              setSubscribing(false)
              if (status === 'CHANNEL_ERROR') {
                console.warn('[NotificationCenter] Realtime subscription failed for company', { companyId, status })
              }
            }
          })

        chanRef.current = chan
        activeCompanyRef.current = companyId
      } catch (error) {
        if (!disposed) {
          console.error('[NotificationCenter] Error setting up realtime subscription', error)
          setSubscribing(false)
        }
      } finally {
        if (settingUpCompanyRef.current === companyId) {
          settingUpCompanyRef.current = null
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [companyId])

  useEffect(() => {
    return () => {
      if (chanRef.current) {
        debugLog('[NotificationCenter] Unmount: removing channel', { companyId: activeCompanyRef.current })
        void supabase.removeChannel(chanRef.current).catch((error) => {
          console.error('[NotificationCenter] Error removing channel on unmount', error)
        })
        chanRef.current = null
        activeCompanyRef.current = null
        settingUpCompanyRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    void fetchLatest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, userId])

  useEffect(() => {
    if (!open) return

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const inPanel = !!target?.closest('[data-role="notif-panel"]')
      const inBtn = !!target?.closest('[data-role="notif-btn"]')
      if (!inPanel && !inBtn) setOpen(false)
    }

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

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
        aria-label={t('notifications.title')}
        onClick={() => {
          setOpen(v => !v)
          if (!rows.length) void fetchLatest()
        }}
        className="relative"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 py-1 text-[10px] leading-none text-white">
            {unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          data-role="notif-panel"
          className="fixed right-4 top-16 z-[99999] w-96 max-w-[95vw] rounded-md border bg-popover text-popover-foreground shadow-lg"
          role="dialog"
          aria-label={t('notifications.title')}
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-sm font-medium">{t('notifications.title')}</div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => void fetchLatest()} title={t('common.refresh')}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void markAllRead()} title={t('notifications.markAllRead')}>
                <CheckCheck className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-auto">
            {rows.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">{t('notifications.noNotifications')}</div>
            )}
            {rows.map((n) => (
              <div key={n.id} className="border-b px-3 py-2 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{n.title || '(no title)'}</div>
                    {n.body && <div className="whitespace-pre-wrap text-xs text-muted-foreground">{n.body}</div>}
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {!n.readAt && <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />}
                </div>
                {n.url && (
                  <div className="mt-2">
                    <a href={n.url} className="text-xs text-primary underline" target="_blank" rel="noreferrer">
                      {t('notifications.open')}
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              {t('notifications.realtime.connecting')}: {subscribing ? t('notifications.realtime.connecting') : t('notifications.realtime.on')}
            </span>
            <span>{t('notifications.showingLatest', { count: rows.length })}</span>
          </div>
        </div>
      )}
    </>
  )
}

export default NotificationCenter
