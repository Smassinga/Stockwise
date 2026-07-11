import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle2, Eye, Plus, RefreshCw, Search, Settings2, ShieldCheck, XCircle } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Textarea } from '../ui/textarea'
import { createPostingRequestKey } from '../../lib/postingRequestKeys'
import { paymentActivationApi, type PaymentChannel, type PaymentRequest, type PaymentRequestEvent } from '../../lib/paymentActivation'

type Props = {
  locale: string
  onOpenCompany: (companyId: string) => void
  tt: (key: string, fallback: string, vars?: Record<string, string | number>) => string
}

const emptyChannel = {
  method_code: '', display_name: '', provider_category: 'other', destination_identifier: '', account_name: '',
  currency_code: 'MZN', operator_instructions: '', customer_instructions: '', is_active: false, sort_order: 100,
}

function formatMoney(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'MZN' }).format(Number(value || 0))
}

export default function PaymentActivationAdmin({ locale, onOpenCompany, tt }: Props) {
  const [requests, setRequests] = useState<PaymentRequest[]>([])
  const [channels, setChannels] = useState<PaymentChannel[]>([])
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PaymentRequest | null>(null)
  const [events, setEvents] = useState<PaymentRequestEvent[]>([])
  const [reviewNote, setReviewNote] = useState('')
  const [acting, setActing] = useState(false)
  const [channelOpen, setChannelOpen] = useState(false)
  const [channelDraft, setChannelDraft] = useState<Partial<PaymentChannel> & typeof emptyChannel>(emptyChannel)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextRequests, nextChannels] = await Promise.all([
        paymentActivationApi.adminListRequests(status === 'all' ? null : status, search || null),
        paymentActivationApi.adminListChannels(),
      ])
      setRequests(nextRequests); setChannels(nextChannels)
    } catch (error) { toast.error((error as Error).message) } finally { setLoading(false) }
  }, [search, status])

  useEffect(() => { void load() }, [load])

  async function openRequest(request: PaymentRequest) {
    try {
      const detail = await paymentActivationApi.adminGetRequest(request.id)
      setSelected(detail.request); setEvents(detail.events); setReviewNote(detail.request.platform_review_note ?? '')
    } catch (error) { toast.error((error as Error).message) }
  }

  async function refreshSelected() {
    if (!selected) return
    const detail = await paymentActivationApi.adminGetRequest(selected.id)
    setSelected(detail.request); setEvents(detail.events)
  }

  async function act(kind: 'review' | 'correction' | 'reject' | 'approve') {
    if (!selected || (kind !== 'review' && !reviewNote.trim())) return
    if (kind === 'approve' && !window.confirm(tt('platform.payment.confirmApproval', 'Approve this verified request and activate or extend company access?'))) return
    setActing(true)
    try {
      const key = createPostingRequestKey()
      if (kind === 'review') await paymentActivationApi.adminStartReview(selected.id, reviewNote, key)
      if (kind === 'correction') await paymentActivationApi.adminRequestCorrection(selected.id, reviewNote, key)
      if (kind === 'reject') await paymentActivationApi.adminReject(selected.id, reviewNote, key)
      if (kind === 'approve') await paymentActivationApi.adminApprove(selected.id, reviewNote, key)
      toast.success(tt('platform.payment.actionComplete', 'Payment request updated'))
      await refreshSelected(); await load()
    } catch (error) { toast.error((error as Error).message) } finally { setActing(false) }
  }

  async function openProof() {
    if (!selected) return
    try { window.open(await paymentActivationApi.createProofUrl(selected.id, true), '_blank', 'noopener,noreferrer') }
    catch (error) { toast.error((error as Error).message) }
  }

  async function saveChannel() {
    setActing(true)
    try {
      await paymentActivationApi.adminUpsertChannel(channelDraft)
      toast.success(tt('platform.payment.channelSaved', 'Payment channel saved'))
      setChannelOpen(false); setChannelDraft(emptyChannel); await load()
    } catch (error) { toast.error((error as Error).message) } finally { setActing(false) }
  }

  const counts = useMemo(() => ({
    submitted: requests.filter((row) => row.status === 'submitted').length,
    underReview: requests.filter((row) => row.status === 'under_review').length,
    correction: requests.filter((row) => row.status === 'needs_correction').length,
  }), [requests])

  return <>
    <Card className="min-w-0 overflow-hidden border-border/70 bg-card [contain:layout_paint]">
      <CardHeader className="border-b border-border/70"><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle>{tt('platform.payment.title', 'Verified payment activation')}</CardTitle><CardDescription className="mt-2 max-w-3xl">{tt('platform.payment.description', 'Review private proof, compare authoritative catalogue amounts, and activate access only after explicit platform verification.')}</CardDescription></div><Button variant="outline" onClick={()=>{setChannelDraft(emptyChannel);setChannelOpen(true)}}><Plus className="h-4 w-4" />{tt('platform.payment.addChannel','Add channel')}</Button></div></CardHeader>
      <CardContent className="min-w-0 space-y-5 overflow-hidden p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border p-4"><div className="text-xs text-muted-foreground">{tt('platform.payment.submitted','Submitted')}</div><div className="mt-1 text-2xl font-semibold">{counts.submitted}</div></div><div className="rounded-lg border p-4"><div className="text-xs text-muted-foreground">{tt('platform.payment.underReview','Under review')}</div><div className="mt-1 text-2xl font-semibold">{counts.underReview}</div></div><div className="rounded-lg border p-4"><div className="text-xs text-muted-foreground">{tt('platform.payment.correction','Correction needed')}</div><div className="mt-1 text-2xl font-semibold">{counts.correction}</div></div></div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem_auto]"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input className="pl-9" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder={tt('platform.payment.search','Search company or request')} /></div><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['all','submitted','under_review','needs_correction','approved','rejected','cancelled'].map((value)=><SelectItem key={value} value={value}>{value.replaceAll('_',' ')}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>{tt('platform.payment.refresh','Refresh')}</Button></div>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[780px] text-sm"><thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">{tt('platform.payment.company','Company')}</th><th className="p-3">{tt('platform.payment.request','Request')}</th><th className="p-3">{tt('platform.payment.plan','Plan')}</th><th className="p-3">{tt('platform.payment.amount','Amount')}</th><th className="p-3">{tt('platform.payment.method','Method')}</th><th className="p-3">{tt('platform.payment.status','Status')}</th><th className="p-3"><span className="sr-only">Actions</span></th></tr></thead><tbody>{requests.map((request)=><tr key={request.id} className="border-t"><td className="p-3 font-medium">{request.company_name}</td><td className="p-3 font-mono text-xs">{request.reference}</td><td className="p-3">{request.plan_name_snapshot}</td><td className="p-3"><div>{formatMoney(request.expected_amount_snapshot,locale)}</div>{request.amount_mismatch?<Badge variant="outline" className="mt-1 border-amber-500/30 text-amber-700 dark:text-amber-300">{tt('platform.payment.mismatch','Mismatch')}</Badge>:null}</td><td className="p-3">{request.payment_channel_display_snapshot}</td><td className="p-3"><Badge variant="outline">{request.status.replaceAll('_',' ')}</Badge></td><td className="p-3"><Button size="sm" variant="outline" onClick={()=>void openRequest(request)}><Eye className="h-4 w-4"/>{tt('platform.payment.review','Review')}</Button></td></tr>)}</tbody></table></div>
        <div className="space-y-2"><div className="flex items-center justify-between"><h3 className="font-semibold">{tt('platform.payment.channels','Payment channels')}</h3><span className="text-xs text-muted-foreground">{channels.length}</span></div><div className="grid gap-3 lg:grid-cols-2">{channels.map((channel)=><div key={channel.id} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border p-4"><div className="min-w-0"><div className="break-words font-medium">{channel.display_name}</div><div className="mt-1 break-words text-xs text-muted-foreground">{channel.provider_category} · {channel.destination_identifier}</div></div><div className="flex shrink-0 gap-2"><Button size="icon" variant="ghost" title={tt('platform.payment.editChannel','Edit channel')} onClick={()=>{setChannelDraft({...emptyChannel,...channel});setChannelOpen(true)}}><Settings2 className="h-4 w-4"/></Button><Button size="sm" variant="outline" onClick={async()=>{await paymentActivationApi.adminSetChannelStatus(channel.id,!channel.is_active);await load()}}>{channel.is_active?tt('platform.payment.deactivate','Deactivate'):tt('platform.payment.activate','Activate')}</Button></div></div>)}</div></div>
      </CardContent>
    </Card>

    <Dialog open={!!selected} onOpenChange={(open)=>{if(!open)setSelected(null)}}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>{selected?.reference}</DialogTitle><DialogDescription>{selected?.company_name} · {selected?.status.replaceAll('_',' ')}</DialogDescription></DialogHeader><DialogBody className="space-y-5 pr-1">{selected?<><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
      [tt('platform.payment.currentStatus','Current status'),selected.current_access_status],[tt('platform.payment.currentPlan','Current plan'),selected.current_plan_code],[tt('platform.payment.requestedPlan','Requested plan'),selected.plan_name_snapshot],[tt('platform.payment.period','Period'),selected.billing_period_snapshot],
      [tt('platform.payment.expected','Expected'),formatMoney(selected.expected_amount_snapshot,locale)],[tt('platform.payment.declared','Declared'),formatMoney(selected.declared_paid_amount??0,locale)],[tt('platform.payment.method','Method'),selected.payment_channel_display_snapshot],[tt('platform.payment.transactionReference','Transaction reference'),selected.provider_transaction_reference],
      [tt('platform.payment.payer','Payer'),selected.payer_name],[tt('platform.payment.submittedAt','Submitted'),selected.submitted_at?new Date(selected.submitted_at).toLocaleString(locale):'-'],[tt('platform.payment.currentPaidUntil','Current paid until'),selected.current_paid_until?new Date(selected.current_paid_until).toLocaleDateString(locale):'-'],[tt('platform.payment.difference','Difference'),formatMoney((selected.declared_paid_amount??0)-selected.expected_amount_snapshot,locale)],
    ].map(([label,value])=><div key={label} className="min-w-0 rounded-lg border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 break-words font-medium">{value||'-'}</div></div>)}</div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>void openProof()}><Eye className="h-4 w-4"/>{tt('platform.payment.openProof','Open proof')}</Button><Button variant="outline" onClick={()=>{onOpenCompany(selected.company_id);setSelected(null)}}>{tt('platform.payment.openCompany','Open company detail')}</Button></div><div className="space-y-2"><Label>{tt('platform.payment.reviewNote','Review note or reason')}</Label><Textarea value={reviewNote} onChange={(e)=>setReviewNote(e.target.value)} placeholder={tt('platform.payment.reviewPlaceholder','Record the verification decision and evidence reviewed')} /></div><div className="rounded-lg border p-4"><h4 className="font-semibold">{tt('platform.payment.timeline','Immutable event timeline')}</h4><div className="mt-3 space-y-3">{events.map((event)=><div key={event.id} className="flex gap-3 text-sm"><div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary"/><div><div className="font-medium">{event.event_type.replaceAll('_',' ')}</div><div className="text-xs text-muted-foreground">#{event.sequence} · {new Date(event.created_at).toLocaleString(locale)}</div>{event.reason?<div className="mt-1 text-muted-foreground">{event.reason}</div>:null}</div></div>)}</div></div></>:null}</DialogBody><DialogFooter>{selected?.status==='submitted'?<Button variant="outline" onClick={()=>void act('review')} disabled={acting}><ShieldCheck className="h-4 w-4"/>{tt('platform.payment.startReview','Start review')}</Button>:null}{selected&&['submitted','under_review'].includes(selected.status)?<><Button variant="outline" onClick={()=>void act('correction')} disabled={acting||!reviewNote.trim()}>{tt('platform.payment.requestCorrection','Request correction')}</Button><Button variant="destructive" onClick={()=>void act('reject')} disabled={acting||!reviewNote.trim()}><XCircle className="h-4 w-4"/>{tt('platform.payment.reject','Reject')}</Button><Button onClick={()=>void act('approve')} disabled={acting||!reviewNote.trim()}><CheckCircle2 className="h-4 w-4"/>{tt('platform.payment.approve','Approve and activate')}</Button></>:null}</DialogFooter></DialogContent></Dialog>

    <Dialog open={channelOpen} onOpenChange={setChannelOpen}><DialogContent><DialogHeader><DialogTitle>{tt('platform.payment.channelEditor','Payment channel')}</DialogTitle><DialogDescription>{tt('platform.payment.channelNoSecrets','Commercial instructions only. Never enter provider credentials, PINs, passwords, or private keys.')}</DialogDescription></DialogHeader><DialogBody className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>{tt('platform.payment.methodCode','Method code')}</Label><Input value={channelDraft.method_code} onChange={(e)=>setChannelDraft({...channelDraft,method_code:e.target.value})}/></div><div className="space-y-2"><Label>{tt('platform.payment.displayName','Display name')}</Label><Input value={channelDraft.display_name} onChange={(e)=>setChannelDraft({...channelDraft,display_name:e.target.value})}/></div><div className="space-y-2"><Label>{tt('platform.payment.provider','Provider category')}</Label><Select value={channelDraft.provider_category} onValueChange={(value)=>setChannelDraft({...channelDraft,provider_category:value})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{['mpesa','emola','mkesh','bank_transfer','other'].map((value)=><SelectItem key={value} value={value}>{value.replace('_',' ')}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>{tt('platform.payment.destination','Destination')}</Label><Input value={channelDraft.destination_identifier} onChange={(e)=>setChannelDraft({...channelDraft,destination_identifier:e.target.value})}/></div><div className="space-y-2 sm:col-span-2"><Label>{tt('platform.payment.customerInstructions','Customer instructions')}</Label><Textarea value={channelDraft.customer_instructions} onChange={(e)=>setChannelDraft({...channelDraft,customer_instructions:e.target.value})}/></div><div className="space-y-2 sm:col-span-2"><Label>{tt('platform.payment.operatorInstructions','Operator instructions')}</Label><Textarea value={channelDraft.operator_instructions??''} onChange={(e)=>setChannelDraft({...channelDraft,operator_instructions:e.target.value})}/></div></DialogBody><DialogFooter><Button onClick={()=>void saveChannel()} disabled={acting||!channelDraft.method_code.trim()||!channelDraft.display_name.trim()||!channelDraft.destination_identifier.trim()||!channelDraft.customer_instructions.trim()}>{tt('platform.payment.saveChannel','Save channel')}</Button></DialogFooter></DialogContent></Dialog>
  </>
}
