import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, CalendarClock, Handshake, MessageSquareWarning, PauseCircle, PlayCircle, UserRoundCheck } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Textarea } from '../ui/textarea'
import { supabase } from '../../lib/supabase'
import { formatMoneyBase } from '../../lib/currency'
import { useI18n, withI18nFallback } from '../../lib/i18n'

type AnchorKind = 'sales_order' | 'sales_invoice'
type ControlStatus = 'active' | 'paused' | 'disputed' | 'promise_to_pay' | 'manual_follow_up' | 'closed'
type Action = 'pause' | 'dispute' | 'promise' | 'manual' | 'resolve'

type Workspace = {
  anchor: {
    active_anchor_kind: AnchorKind
    active_anchor_id: string
    exposure_chain_id: string
    active_document_reference: string
    customer_name?: string | null
    due_date?: string | null
    outstanding_amount?: number | null
    currency_code?: string | null
  }
  control: {
    id?: string
    status: ControlStatus
    version: number
    owner_user_id?: string | null
    next_action_at?: string | null
    pause_until?: string | null
    dispute_category?: string | null
    dispute_summary?: string | null
    reason_note?: string | null
  }
  promise?: {
    id: string
    promised_amount: number
    currency_code: string
    promised_date: string
    status: string
    source: string
  } | null
  events: Array<{
    id: string
    event_type: string
    occurred_at: string
    safe_note?: string | null
    document_reference_snapshot: string
  }>
  reminders: Array<{
    id: string
    status: string
    stageOffsetDays: number
    acceptedAt?: string | null
    skipReason?: string | null
  }>
}

type Member = { user_id: string; email: string }

const managerRoles = new Set(['OWNER', 'ADMIN', 'MANAGER'])

const collectionEventLabels: Record<string, { en: string; pt: string }> = {
  control_activated: { en: 'Automatic reminders activated', pt: 'Lembretes automáticos activados' },
  reminder_paused: { en: 'Reminders paused', pt: 'Lembretes suspensos' },
  pause_extended: { en: 'Pause extended', pt: 'Suspensão prolongada' },
  pause_expired: { en: 'Pause expired', pt: 'Suspensão terminada' },
  dispute_opened: { en: 'Dispute opened', pt: 'Reclamação aberta' },
  dispute_updated: { en: 'Dispute updated', pt: 'Reclamação actualizada' },
  dispute_resolved: { en: 'Dispute resolved', pt: 'Reclamação resolvida' },
  promise_recorded: { en: 'Promise to pay recorded', pt: 'Promessa de pagamento registada' },
  promise_revised: { en: 'Promise to pay revised', pt: 'Promessa de pagamento revista' },
  promise_kept: { en: 'Promise kept', pt: 'Promessa cumprida' },
  promise_partially_kept: { en: 'Promise partially kept', pt: 'Promessa parcialmente cumprida' },
  promise_broken: { en: 'Promise broken', pt: 'Promessa não cumprida' },
  promise_cancelled: { en: 'Promise cancelled', pt: 'Promessa cancelada' },
  manual_follow_up_assigned: { en: 'Manual follow-up assigned', pt: 'Acompanhamento manual atribuído' },
  manual_follow_up_completed: { en: 'Manual follow-up completed', pt: 'Acompanhamento manual concluído' },
  control_reactivated: { en: 'Automatic reminders reactivated', pt: 'Lembretes automáticos reactivados' },
  anchor_moved_to_invoice: { en: 'Active document moved to invoice', pt: 'Documento activo transferido para a fatura' },
  control_closed_after_settlement: { en: 'Collections control closed after settlement', pt: 'Controlo de cobrança encerrado após liquidação' },
}

function localDateTime(days = 1) {
  const date = new Date(Date.now() + days * 86400000)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

export function CollectionsControlPanel({
  companyId,
  anchorKind,
  anchorId,
  role,
}: {
  companyId: string
  anchorKind: AnchorKind
  anchorId: string
  role?: string | null
}) {
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const canManage = managerRoles.has(String(role || '').toUpperCase())
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [owner, setOwner] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [nextAction, setNextAction] = useState(localDateTime(1))
  const [pauseUntil, setPauseUntil] = useState(localDateTime(3))
  const [disputeCategory, setDisputeCategory] = useState('pricing')
  const [disputedAmount, setDisputedAmount] = useState('')
  const [promiseAmount, setPromiseAmount] = useState('')
  const [promiseDate, setPromiseDate] = useState(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10))
  const [promiseSource, setPromiseSource] = useState('customer_call')

  const load = useCallback(async () => {
    setLoading(true)
    const [workspaceResult, membersResult] = await Promise.all([
      supabase.rpc('get_ar_collection_workspace', { p_anchor_kind: anchorKind, p_anchor_id: anchorId }),
      supabase.from('company_members_with_auth').select('user_id,email').eq('company_id', companyId).eq('status', 'active'),
    ])
    if (workspaceResult.error) {
      toast.error(tt('collections.loadFailed', 'Collections control could not be loaded.'))
      setLoading(false)
      return
    }
    const next = workspaceResult.data as Workspace
    setWorkspace(next)
    setMembers((membersResult.data || []).filter((row): row is Member => Boolean(row.user_id && row.email)))
    setOwner(next.control.owner_user_id || (membersResult.data?.[0]?.user_id ?? ''))
    setPromiseAmount(String(Number(next.anchor.outstanding_amount || 0).toFixed(2)))
    setLoading(false)
  }, [anchorId, anchorKind, companyId, lang])

  useEffect(() => { void load() }, [load])

  const copy = useMemo(() => lang === 'pt' ? {
    title: 'Controlo de cobranças', description: 'Gira lembretes automáticos, reclamações e compromissos sem alterar o saldo financeiro.',
    active: 'Lembretes automáticos activos', paused: 'Lembretes suspensos', disputed: 'Em reclamação',
    promise_to_pay: 'Promessa de pagamento', manual_follow_up: 'Acompanhamento manual', closed: 'Encerrado',
    pause: 'Suspender lembretes', dispute: 'Abrir reclamação', promise: 'Registar promessa', manual: 'Atribuir acompanhamento', resolve: 'Resolver controlo actual', activate: 'Activar lembretes',
  } : {
    title: 'Collections control', description: 'Manage automatic reminders, disputes and commitments without changing the financial balance.',
    active: 'Automatic reminders active', paused: 'Reminders paused', disputed: 'Disputed',
    promise_to_pay: 'Promise to pay', manual_follow_up: 'Manual follow-up', closed: 'Closed',
    pause: 'Pause reminders', dispute: 'Open dispute', promise: 'Record promise', manual: 'Assign follow-up', resolve: 'Resolve current control', activate: 'Activate reminders',
  }, [lang])

  function resetDialog(nextActionType: Action) {
    setAction(nextActionType)
    setReason(nextActionType === 'pause' ? 'customer_requested_time' : nextActionType === 'manual' ? 'customer_follow_up' : '')
    setNote('')
  }

  async function callRpc(name: string, command: Record<string, unknown>) {
    setSaving(true)
    const { error } = await supabase.rpc(name, { p_command: {
      company_id: companyId,
      anchor_kind: anchorKind,
      anchor_id: anchorId,
      expected_version: workspace?.control.version || undefined,
      request_key: crypto.randomUUID(),
      ...command,
    } })
    setSaving(false)
    if (error) {
      toast.error(error.message.includes('stale_collection_control_version')
        ? tt('collections.stale', 'This control changed. Review the latest state and try again.')
        : tt('collections.saveFailed', 'The collections control could not be saved.'))
      await load()
      return false
    }
    setAction(null)
    toast.success(tt('collections.saved', 'Collections control updated.'))
    await load()
    return true
  }

  async function submit() {
    if (!action || !workspace) return
    if (action === 'pause') await callRpc('pause_collection_reminders', { reason_code: reason, note, owner_user_id: owner, pause_until: new Date(pauseUntil).toISOString(), next_action_at: new Date(nextAction).toISOString() })
    if (action === 'dispute') await callRpc('open_collection_dispute', { reason_code: 'customer_dispute', note, owner_user_id: owner, dispute_category: disputeCategory, dispute_summary: note, disputed_amount: disputedAmount || undefined, follow_up_at: new Date(nextAction).toISOString() })
    if (action === 'promise') await callRpc('record_payment_promise', { promised_amount: Number(promiseAmount), promised_date: promiseDate, source: promiseSource, note, owner_user_id: owner, next_follow_up_at: new Date(nextAction).toISOString(), timezone: 'Africa/Maputo' })
    if (action === 'manual') await callRpc('assign_manual_follow_up', { reason_code: reason, note, owner_user_id: owner, next_action_at: new Date(nextAction).toISOString() })
    if (action === 'resolve' && status === 'disputed') await callRpc('resolve_collection_dispute', { resolution_outcome: reason || 'no_change', resulting_status: 'manual_follow_up', note, next_action_at: new Date(nextAction).toISOString() })
    if (action === 'resolve' && status === 'manual_follow_up') await callRpc('complete_manual_follow_up', { resulting_status: 'active', reason_code: reason || 'follow_up_completed', note })
    if (action === 'resolve' && status === 'promise_to_pay') await callRpc('cancel_payment_promise', { exposure_chain_id: workspace.anchor.exposure_chain_id, reason: note, next_action_at: new Date(nextAction).toISOString() })
  }

  async function activate() {
    await callRpc('set_collection_active', { reason_code: 'manual_reactivation', note: tt('collections.reactivatedNote', 'Automatic reminders reactivated after review.') })
  }

  if (loading) return <Card><CardContent className="py-6 text-sm text-muted-foreground">{tt('loading', 'Loading…')}</CardContent></Card>
  if (!workspace) return null
  const status = workspace.control.status
  const outstanding = formatMoneyBase(Number(workspace.anchor.outstanding_amount || 0), workspace.anchor.currency_code || 'MZN', locale)
  const lastReminder = workspace.reminders.find(row => row.status === 'accepted')

  return <>
    <Card id="collections-control" className="overflow-hidden">
      <CardHeader className="gap-3 border-b bg-muted/20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Handshake className="h-5 w-5" />{copy.title}</CardTitle>
            <CardDescription className="mt-1">{copy.description}</CardDescription>
          </div>
          <Badge variant={status === 'active' ? 'default' : status === 'closed' ? 'secondary' : 'outline'}>{copy[status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{tt('collections.activeDocument', 'Active document')}</div><div className="mt-1 font-medium">{workspace.anchor.active_document_reference}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{tt('collections.customer', 'Customer')}</div><div className="mt-1 font-medium">{workspace.anchor.customer_name || '—'}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</div><div className="mt-1 font-mono font-semibold tabular-nums">{outstanding}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{tt('orders.dueDate', 'Due date')}</div><div className="mt-1 font-medium">{workspace.anchor.due_date || '—'}</div></div>
        </div>

        {workspace.promise ? <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="font-medium">{tt('collections.promiseSummary', 'Promise to pay')}: {formatMoneyBase(workspace.promise.promised_amount, workspace.promise.currency_code, locale)} {tt('collections.byDate', 'by')} {workspace.promise.promised_date}</div>
          <div className="mt-1 text-sm text-muted-foreground">{tt('collections.remindersSuppressedPromise', 'Automatic reminders are paused until the promise is evaluated.')}</div>
        </div> : null}
        {status === 'disputed' ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"><div className="font-medium">{workspace.control.dispute_summary}</div><div className="mt-1 text-sm text-muted-foreground">{tt('collections.disputeBalanceTruth', 'The dispute does not change the authoritative outstanding balance.')}</div></div> : null}

        {canManage && status !== 'closed' ? <div className="flex flex-wrap gap-2">
          {status !== 'active' ? <Button onClick={() => void activate()} disabled={saving}><PlayCircle className="mr-2 h-4 w-4" />{copy.activate}</Button> : null}
          <Button variant="outline" onClick={() => resetDialog('pause')}><PauseCircle className="mr-2 h-4 w-4" />{copy.pause}</Button>
          <Button variant="outline" onClick={() => resetDialog('dispute')}><MessageSquareWarning className="mr-2 h-4 w-4" />{copy.dispute}</Button>
          <Button variant="outline" onClick={() => resetDialog('promise')}><CalendarClock className="mr-2 h-4 w-4" />{copy.promise}</Button>
          <Button variant="outline" onClick={() => resetDialog('manual')}><UserRoundCheck className="mr-2 h-4 w-4" />{copy.manual}</Button>
          {status === 'disputed' || status === 'promise_to_pay' || status === 'manual_follow_up' ? <Button variant="secondary" onClick={() => resetDialog('resolve')}>{copy.resolve}</Button> : null}
        </div> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">{tt('collections.reminderPosition', 'Reminder lifecycle')}</h3>
            <div className="mt-2 text-sm text-muted-foreground">{lastReminder ? tt('collections.lastAcceptedStage', 'Last accepted stage: {stage}', { stage: lastReminder.stageOffsetDays }) : tt('collections.noAcceptedReminder', 'No automatic reminder has been accepted for this exposure.')}</div>
            {workspace.control.next_action_at ? <div className="mt-1 text-sm">{tt('collections.nextAction', 'Next action')}: {new Date(workspace.control.next_action_at).toLocaleString(locale)}</div> : null}
          </div>
          <div>
            <h3 className="text-sm font-semibold">{tt('collections.timeline', 'Collections timeline')}</h3>
            <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
              {workspace.events.length ? workspace.events.map(event => {
                const eventLabel = collectionEventLabels[event.event_type]?.[lang]
                  ?? (lang === 'pt' ? 'Actividade de cobrança' : 'Collections activity')
                return <div key={event.id} className="rounded-md border p-2 text-sm"><div className="font-medium">{tt(`collections.event.${event.event_type}`, eventLabel)}</div><div className="text-xs text-muted-foreground">{new Date(event.occurred_at).toLocaleString(locale)}</div>{event.safe_note ? <div className="mt-1 text-muted-foreground">{event.safe_note}</div> : null}</div>
              }) : <div className="text-sm text-muted-foreground">{tt('collections.timelineEmpty', 'No control events yet. Automatic reminders are active by default.')}</div>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <Dialog open={Boolean(action)} onOpenChange={open => !open && setAction(null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{action ? copy[action] : copy.title}</DialogTitle>
          <DialogDescription>{action === 'pause'
            ? tt('collections.pauseEffect', lang === 'pt' ? 'Os lembretes automáticos ao cliente ficarão suspensos até à data seleccionada. O acompanhamento interno continuará activo.' : 'Automatic customer reminders will stop until the selected date. Internal follow-up remains active.')
            : action === 'dispute'
              ? tt('collections.disputeEffect', lang === 'pt' ? 'Os lembretes automáticos ao cliente ficarão suspensos enquanto esta reclamação estiver aberta. O saldo em aberto não será alterado sem registo de pagamento, crédito ou correcção do documento.' : 'Automatic customer reminders will stop while this dispute remains open. The outstanding balance will not change unless a settlement, credit or document correction is recorded.')
            : action === 'promise'
                ? tt('collections.promiseEffect', lang === 'pt' ? 'A promessa não regista um pagamento nem altera a data de vencimento. Os lembretes ficam suspensos até à avaliação.' : 'The promise does not post a payment or change the document due date. Reminders stay suspended until evaluation.')
                : action === 'resolve'
                  ? tt('collections.resolveEffect', lang === 'pt' ? 'A conclusão deste controlo regista um evento imutável e selecciona o próximo estado governado. Não altera o saldo financeiro.' : 'Completing this control records an immutable event and selects the next governed state. It does not change the financial balance.')
                  : tt('collections.manualEffect', lang === 'pt' ? 'Os lembretes automáticos ao cliente ficarão suspensos enquanto o acompanhamento atribuído estiver aberto.' : 'Automatic customer reminders will stop while the assigned follow-up remains open.')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="rounded-lg bg-muted/40 p-3 text-sm"><span className="text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}: </span><strong>{outstanding}</strong></div>
          <div><Label>{tt('collections.owner', 'Owner')}</Label><Select value={owner} onValueChange={setOwner}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{members.map(member => <SelectItem key={member.user_id} value={member.user_id}>{member.email}</SelectItem>)}</SelectContent></Select></div>
          {action === 'pause' ? <><div><Label>{tt('collections.pauseReason', 'Pause reason')}</Label><Select value={reason} onValueChange={setReason}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['awaiting_payment_confirmation','customer_requested_time','internal_review','document_correction','management_instruction','other'].map(value => <SelectItem key={value} value={value}>{tt(`collections.reason.${value}`, value.replaceAll('_', ' '))}</SelectItem>)}</SelectContent></Select></div><div><Label>{tt('collections.pauseUntil', 'Pause until')}</Label><Input type="datetime-local" value={pauseUntil} onChange={event => setPauseUntil(event.target.value)} /></div></> : null}
          {action === 'dispute' ? <><div><Label>{tt('collections.disputeCategory', 'Dispute category')}</Label><Select value={disputeCategory} onValueChange={setDisputeCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['pricing','quantity','service_quality','delivery','tax','duplicate_document','incorrect_customer_details','payment_allocation','credit_note_pending','missing_support','other'].map(value => <SelectItem key={value} value={value}>{tt(`collections.dispute.${value}`, value.replaceAll('_', ' '))}</SelectItem>)}</SelectContent></Select></div><div><Label>{tt('collections.disputedAmount', 'Disputed amount (optional)')}</Label><Input inputMode="decimal" value={disputedAmount} onChange={event => setDisputedAmount(event.target.value)} /></div></> : null}
          {action === 'promise' ? <><div><Label>{tt('collections.promisedAmount', 'Promised amount')}</Label><Input inputMode="decimal" value={promiseAmount} onChange={event => setPromiseAmount(event.target.value)} /></div><div><Label>{tt('collections.promisedDate', 'Promised date')}</Label><Input type="date" value={promiseDate} onChange={event => setPromiseDate(event.target.value)} /></div><div><Label>{tt('collections.promiseSource', 'Source')}</Label><Select value={promiseSource} onValueChange={setPromiseSource}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['customer_email','customer_call','customer_message','internal_agreement','other'].map(value => <SelectItem key={value} value={value}>{tt(`collections.source.${value}`, value.replaceAll('_', ' '))}</SelectItem>)}</SelectContent></Select></div></> : null}
          {action === 'manual' ? <div><Label>{tt('collections.followUpReason', 'Follow-up reason')}</Label><Input value={reason} onChange={event => setReason(event.target.value)} /></div> : null}
          {action === 'resolve' && status === 'disputed' ? <div><Label>{tt('collections.resolutionOutcome', 'Resolution outcome')}</Label><Select value={reason || 'no_change'} onValueChange={setReason}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['customer_accepted','company_accepted','partial_agreement','credit_or_adjustment_issued','document_corrected','payment_received','no_change','cancelled'].map(value => <SelectItem key={value} value={value}>{tt(`collections.resolution.${value}`, value.replaceAll('_', ' '))}</SelectItem>)}</SelectContent></Select></div> : null}
          <div><Label>{tt('collections.nextAction', 'Next action')}</Label><Input type="datetime-local" value={nextAction} onChange={event => setNextAction(event.target.value)} /></div>
          <div><Label>{tt('collections.note', 'Note')}</Label><Textarea value={note} onChange={event => setNote(event.target.value)} maxLength={2000} /></div>
          <div className="flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{tt('collections.noFinancialMutation', 'This control does not post payment, credit, tax or accounting evidence.')}</span></div>
        </DialogBody>
        <DialogFooter><Button variant="outline" onClick={() => setAction(null)}>{tt('cancel', 'Cancel')}</Button><Button onClick={() => void submit()} disabled={saving || !owner || !note.trim()}>{saving ? tt('saving', 'Saving…') : tt('save', 'Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}