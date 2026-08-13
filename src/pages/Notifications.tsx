import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bell, Check, CheckCheck, CircleAlert, ExternalLink, Info, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PremiumEmptyState, PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import { PremiumPageHeader } from '../components/premium/PremiumPageHeader'
import { PremiumSkeleton } from '../components/premium/PremiumSkeleton'
import { PremiumStatusBadge, type PremiumTone } from '../components/premium/PremiumStatusBadge'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../hooks/useOrg'
import { useI18n } from '../lib/i18n'
import { notificationPresentation, safeNotificationActionUrl } from '../lib/notificationPresentation'
import { prepareNotificationNavigation } from '../lib/notificationNavigation'
import { supabase } from '../lib/supabase'

type Row = {
  id: string
  title: string | null
  body: string | null
  event_type: string | null
  category: string | null
  payload: Record<string, unknown>
  severity: string | null
  action_url: string | null
  url: string | null
  occurred_at: string | null
  created_at: string
  read_at: string | null
  dismissed_at: string | null
  company_id: string
}

function severityTone(severity: string | null): PremiumTone {
  if (severity === 'success') return 'success'
  if (severity === 'warning') return 'warning'
  if (severity === 'error' || severity === 'danger' || severity === 'critical') return 'danger'
  return 'info'
}

function SeverityIcon({ severity }: { severity: string | null }) {
  if (severity === 'success') return <Check />
  if (severity === 'warning') return <AlertTriangle />
  if (severity === 'error' || severity === 'danger' || severity === 'critical') return <CircleAlert />
  return <Info />
}

export default function NotificationsPage() {
  const navigate = useNavigate()
  const { lang } = useI18n()
  const { companyId, setActiveCompany } = useOrg()
  const { user } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [category, setCategory] = useState('all')
  const [unread, setUnread] = useState('all')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState(false)
  const copy = lang === 'pt'
    ? {
        title: 'Notificações',
        allCategories: 'Todas as categorias',
        categoryLabel: 'Filtrar por categoria',
        unread: 'Não lida',
        unreadOnly: 'Apenas não lidas',
        stateLabel: 'Filtrar por estado de leitura',
        allStates: 'Todas',
        markRead: 'Marcar como lida',
        markAll: 'Marcar todas como lidas',
        empty: 'Nenhuma notificação corresponde aos filtros.',
        emptyHelp: 'Altere os filtros ou volte mais tarde.',
        open: 'Abrir',
        dismiss: 'Dispensar',
        loading: 'A carregar notificações',
        unavailable: 'Não foi possível carregar as notificações.',
        unavailableHelp: 'Tente novamente. Nenhuma notificação foi alterada.',
        actionFailed: 'Não foi possível atualizar a notificação. Tente novamente.',
        retry: 'Tentar novamente',
        severity: { success: 'Sucesso', warning: 'Aviso', danger: 'Erro', info: 'Informação' },
      }
    : {
        title: 'Notifications',
        allCategories: 'All categories',
        categoryLabel: 'Filter by category',
        unread: 'Unread',
        unreadOnly: 'Unread only',
        stateLabel: 'Filter by read state',
        allStates: 'All',
        markRead: 'Mark as read',
        markAll: 'Mark all read',
        empty: 'No notifications match these filters.',
        emptyHelp: 'Change the filters or check again later.',
        open: 'Open',
        dismiss: 'Dismiss',
        loading: 'Loading notifications',
        unavailable: 'Notifications could not be loaded.',
        unavailableHelp: 'Try again. No notifications were changed.',
        actionFailed: 'The notification could not be updated. Try again.',
        retry: 'Try again',
        severity: { success: 'Success', warning: 'Warning', danger: 'Error', info: 'Information' },
      }

  async function load() {
    if (!companyId || !user?.id) return
    setLoading(true)
    setLoadError(false)
    const { data, error } = await supabase
      .from('notifications')
      .select('id,title,body,event_type,category,payload,severity,action_url,url,occurred_at,created_at,read_at,dismissed_at,company_id')
      .eq('company_id', companyId)
      .or(`user_id.eq.${user.id},user_id.is.null`)
      .is('dismissed_at', null)
      .order('occurred_at', { ascending: false, nullsFirst: false })
      .range(0, 99)
    if (error) {
      console.error('Notification load error:', error)
      setLoadError(true)
      setRows([])
    } else {
      setRows((data || []) as Row[])
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [companyId, user?.id])

  const visible = useMemo(
    () => rows.filter((row) => (category === 'all' || row.category === category) && (unread === 'all' || !row.read_at)),
    [category, rows, unread],
  )
  const categories = [...new Set(rows.map((row) => row.category).filter(Boolean))] as string[]
  const unreadIds = rows.filter((row) => !row.read_at).map((row) => row.id)

  async function updateNotification(id: string, patch: { read_at?: string; dismissed_at?: string }) {
    setActionError(false)
    const { error } = await supabase.from('notifications').update(patch).eq('id', id)
    if (error) {
      console.error('Notification update error:', error)
      setActionError(true)
      return
    }
    if (patch.dismissed_at) {
      setRows((current) => current.filter((row) => row.id !== id))
    } else {
      setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
    }
  }

  async function markAll() {
    if (!unreadIds.length) return
    setActionError(false)
    const now = new Date().toISOString()
    const { error } = await supabase.from('notifications').update({ read_at: now }).in('id', unreadIds)
    if (error) {
      console.error('Notification mark-all error:', error)
      setActionError(true)
      return
    }
    const changed = new Set(unreadIds)
    setRows((current) => current.map((row) => changed.has(row.id) ? { ...row, read_at: now } : row))
  }

  function categoryLabel(value: string) {
    return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
  }

  async function openNotification(row: Row, actionUrl: string) {
    setActionError(false)
    const prepared = await prepareNotificationNavigation({
      actionUrl,
      notificationCompanyId: row.company_id,
      currentCompanyId: companyId,
      userId: user?.id,
      setActiveCompany,
    })
    if (!prepared) {
      setActionError(true)
      return
    }
    if (!row.read_at) {
      await updateNotification(row.id, { read_at: new Date().toISOString() })
    }
    navigate(prepared)
  }

  return (
    <div className="app-page space-y-6">
      <PremiumPageHeader
        title={copy.title}
        actions={(
          <Button variant="outline" disabled={loading || unreadIds.length === 0} onClick={() => void markAll()}>
            <CheckCheck className="mr-2 h-4 w-4" />
            {copy.markAll}
          </Button>
        )}
      />

      <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label={copy.categoryLabel}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{copy.allCategories}</SelectItem>
            {categories.map((value) => <SelectItem key={value} value={value}>{categoryLabel(value)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={unread} onValueChange={setUnread}>
          <SelectTrigger aria-label={copy.stateLabel}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{copy.allStates}</SelectItem>
            <SelectItem value="unread">{copy.unreadOnly}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {actionError ? <PremiumStatePanel kind="error" compact title={copy.actionFailed} /> : null}

      {loading ? (
        <PremiumSkeleton variant="list" rows={5} label={copy.loading} />
      ) : loadError ? (
        <PremiumStatePanel
          kind="error"
          title={copy.unavailable}
          description={copy.unavailableHelp}
          action={<Button type="button" variant="outline" onClick={() => void load()}>{copy.retry}</Button>}
        />
      ) : visible.length === 0 ? (
        <PremiumEmptyState icon={<Bell />} title={copy.empty} description={copy.emptyHelp} />
      ) : (
        <section aria-label={copy.title} className="divide-y divide-border border-y border-border">
          {visible.map((row) => {
            const presentation = notificationPresentation(row, lang)
            const action = safeNotificationActionUrl(row.action_url || row.url)
            const tone = severityTone(row.severity)
            return (
              <article key={row.id} className="flex flex-col gap-4 py-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <PremiumStatusBadge tone={tone} icon={<SeverityIcon severity={row.severity} />}>
                      {copy.severity[tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'info']}
                    </PremiumStatusBadge>
                    {!row.read_at ? <PremiumStatusBadge tone="neutral">{copy.unread}</PremiumStatusBadge> : null}
                  </div>
                  <h2 className="mt-3 font-semibold text-foreground">{presentation.title}</h2>
                  {presentation.body ? <p className="mt-1 max-w-3xl break-words text-sm leading-6 text-muted-foreground">{presentation.body}</p> : null}
                  <time className="mt-2 block text-xs text-muted-foreground" dateTime={row.occurred_at || row.created_at}>
                    {new Date(row.occurred_at || row.created_at).toLocaleString(lang === 'pt' ? 'pt-MZ' : 'en-MZ')}
                  </time>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {!row.read_at ? (
                    <Button size="sm" variant="outline" onClick={() => void updateNotification(row.id, { read_at: new Date().toISOString() })}>
                      <Check className="mr-2 h-4 w-4" />{copy.markRead}
                    </Button>
                  ) : null}
                  {action ? (
                    <Button size="sm" onClick={() => void openNotification(row, action)}>
                      <ExternalLink className="mr-2 h-4 w-4" />{copy.open}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => void updateNotification(row.id, { dismissed_at: new Date().toISOString() })}>
                    <X className="mr-2 h-4 w-4" />{copy.dismiss}
                  </Button>
                </div>
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}
