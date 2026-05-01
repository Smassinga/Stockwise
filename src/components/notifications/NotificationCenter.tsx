// src/components/notifications/NotificationCenter.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, CheckCheck, Loader2, RefreshCw } from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
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
  level: string
}

type RealtimeStatus = 'off' | 'connecting' | 'on' | 'reconnecting'

const NOTIFICATION_SELECT = 'id,title,body,created_at,read_at,url,level,user_id,company_id'
const NOTIFICATION_SELECT_FALLBACK = 'id,title,body,created_at,read_at,url,level'
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
    level: String(pick(r, ['level', 'severity'], 'info') ?? 'info'),
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
  const navigate = useNavigate()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const { user } = useAuth() as any
  const userId: string | null = user?.id ?? null
  const { companyId } = useOrg()

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<Notif[]>([])
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('off')
  const [reconnectTick, setReconnectTick] = useState(0)

  const chanRef = useRef<RealtimeChannel | null>(null)
  const activeCompanyRef = useRef<string | null>(null)
  const activeUserRef = useRef<string | null>(userId)
  const settingUpCompanyRef = useRef<string | null>(null)
  const retryTimerRef = useRef<number | null>(null)
  const retryAttemptsRef = useRef(0)

  const unreadCount = useMemo(() => rows.filter(r => !r.readAt).length, [rows])

  function formatStamp(value: string) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  }

  function levelClasses(level: string) {
    const normalized = level.toLowerCase()
    if (normalized === 'warning') {
      return 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    }
    if (normalized === 'error') {
      return 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
    }
    return 'border-border/70 bg-muted/35 text-muted-foreground'
  }

  function openNotification(notification: Notif) {
    if (!notification.url) return
    setOpen(false)
    if (notification.url.startsWith('/')) {
      navigate(notification.url)
      return
    }
    window.open(notification.url, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    activeUserRef.current = userId
  }, [userId])

  function clearRetryTimer() {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }

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
      clearRetryTimer()
      retryAttemptsRef.current = 0
      setRealtimeStatus('off')
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

    clearRetryTimer()

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
    setRealtimeStatus(retryAttemptsRef.current > 0 ? 'reconnecting' : 'connecting')

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
        chanRef.current = chan
        activeCompanyRef.current = companyId

        if (disposed) {
          chanRef.current = null
          activeCompanyRef.current = null
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
            if (disposed || chanRef.current !== chan || activeCompanyRef.current !== companyId) return
            debugLog('[NotificationCenter] Subscription status changed', { status, companyId })

            if (status === 'SUBSCRIBED') {
              clearRetryTimer()
              retryAttemptsRef.current = 0
              setRealtimeStatus('on')
              return
            }

            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              setRealtimeStatus(status === 'CLOSED' ? 'off' : 'reconnecting')
              if (chanRef.current === chan) {
                chanRef.current = null
                activeCompanyRef.current = null
              }
              void supabase.removeChannel(chan).catch((error) => {
                if (isDev) console.warn('[NotificationCenter] Error removing failed realtime channel', error)
              })

              if (retryTimerRef.current !== null || status === 'CLOSED' && disposed) return

              retryAttemptsRef.current += 1
              const attempt = retryAttemptsRef.current
              const delay = Math.min(15000, attempt * 3000)

              if (isDev) {
                if (attempt >= 2 && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
                  console.warn('[NotificationCenter] Realtime subscription retry scheduled', { companyId, status, attempt, delay })
                } else {
                  debugLog('[NotificationCenter] Realtime subscription reconnecting', { companyId, status, attempt, delay })
                }
              }

              retryTimerRef.current = window.setTimeout(() => {
                retryTimerRef.current = null
                if (!disposed && activeUserRef.current !== undefined) {
                  setReconnectTick((value) => value + 1)
                }
              }, delay)
            }
          })
      } catch (error) {
        if (!disposed) {
          if (isDev) console.error('[NotificationCenter] Error setting up realtime subscription', error)
          setRealtimeStatus('reconnecting')
          if (retryTimerRef.current === null) {
            retryAttemptsRef.current += 1
            const delay = Math.min(15000, retryAttemptsRef.current * 3000)
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null
              if (!disposed) setReconnectTick((value) => value + 1)
            }, delay)
          }
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
  }, [companyId, reconnectTick])

  useEffect(() => {
    return () => {
      clearRetryTimer()
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
        variant="outline"
        size="sm"
        data-role="notif-btn"
        aria-label={t('notifications.title')}
        onClick={() => {
          setOpen(v => !v)
          if (!rows.length) void fetchLatest()
        }}
        className="relative h-10 w-10 rounded-xl border-border/70 bg-background/82 px-0 shadow-[0_12px_24px_-22px_hsl(var(--foreground)/0.24)]"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 py-1 text-[10px] leading-none text-white shadow-[0_10px_22px_-12px_rgba(220,38,38,0.9)]">
            {unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-[99998] bg-slate-950/24 backdrop-blur-[2px] dark:bg-slate-950/56 md:bg-slate-950/16" aria-hidden />
          <div
            data-role="notif-panel"
            className="fixed inset-x-[max(0.75rem,var(--app-safe-left))] top-[calc(var(--app-shell-mobile-header)+var(--app-safe-top)+0.6rem)] z-[99999] flex max-h-[calc(100dvh-var(--app-shell-mobile-header)-var(--app-shell-mobile-dock)-var(--app-safe-top)-var(--app-safe-bottom)-1.45rem)] flex-col overflow-hidden rounded-[1.45rem] border border-zinc-200 bg-white text-zinc-950 shadow-[0_34px_90px_-32px_rgba(15,23,42,0.55)] ring-1 ring-black/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:shadow-[0_34px_90px_-28px_rgba(0,0,0,0.85)] dark:ring-white/10 md:inset-x-auto md:right-6 md:top-20 md:w-[27.5rem] md:max-w-[calc(100vw-3rem)] md:max-h-[min(72vh,38rem)] xl:right-8"
            role="dialog"
            aria-label={t('notifications.title')}
          >
          <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t('notifications.title')}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {unreadCount > 0
                  ? t('notifications.showingLatest', { count: unreadCount })
                  : t('notifications.emptyHelp')}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => void fetchLatest()} title={t('common.refresh')}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => void markAllRead()} title={t('notifications.markAllRead')}>
                <CheckCheck className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-zinc-100 px-2.5 py-2.5 dark:bg-zinc-900">
            {rows.length === 0 && (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-4 py-8 text-center dark:border-zinc-700 dark:bg-zinc-950">
                <div className="text-sm font-medium">{t('notifications.noNotifications')}</div>
                <div className="mt-2 text-xs leading-5 text-muted-foreground">{t('notifications.emptyHelp')}</div>
              </div>
            )}
            <div className="space-y-2.5">
              {rows.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-2xl border px-3.5 py-3.5 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.48)] transition-colors dark:shadow-[0_18px_40px_-30px_rgba(0,0,0,0.9)] ${
                    n.readAt
                      ? 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900'
                      : 'border-primary/35 bg-primary/8 hover:bg-primary/12 dark:border-primary/30 dark:bg-primary/12 dark:hover:bg-primary/16'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${levelClasses(n.level)}`}>
                          {n.level}
                        </span>
                        {!n.readAt && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary/18 bg-primary/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-primary">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                            {t('notifications.status.new')}
                          </span>
                        )}
                      </div>
                      <div className="break-words text-sm font-semibold leading-5 text-foreground">{n.title || '(no title)'}</div>
                      {n.body ? <div className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{n.body}</div> : null}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{formatStamp(n.createdAt)}</span>
                        <span aria-hidden>|</span>
                        <span>{n.readAt ? t('notifications.status.read') : t('notifications.status.unread')}</span>
                      </div>
                    </div>
                    {n.url ? (
                      <Button
                        type="button"
                        variant={n.readAt ? 'outline' : 'secondary'}
                        size="sm"
                        className="shrink-0 rounded-xl"
                        onClick={() => openNotification(n)}
                      >
                        {t('notifications.open')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-4 py-3 text-[11px] text-muted-foreground dark:border-zinc-800 dark:bg-zinc-950">
            <span>{t(`notifications.realtime.${realtimeStatus}`)}</span>
            <span>{t('notifications.showingLatest', { count: rows.length })}</span>
          </div>
          </div>
        </>
      )}
    </>
  )
}

export default NotificationCenter
