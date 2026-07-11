import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, CheckCircle2, Clock3, FileCheck2, RefreshCw, ShieldCheck, Upload } from 'lucide-react'
import BrandLockup from '../components/brand/BrandLockup'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import { useOrg } from '../hooks/useOrg'
import { getMyCompanyAccessState, type CompanyAccessState } from '../lib/companyAccess'
import { createPostingRequestKey } from '../lib/postingRequestKeys'
import { paymentActivationApi, type PaymentChannel, type PaymentPlanOption, type PaymentRequest, type PaymentRequestEvent } from '../lib/paymentActivation'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { PUBLIC_CONTACT_EMAIL } from '../lib/publicContact'

const copy = {
  en: {
    eyebrow: 'Verified activation request', title: 'Activate or renew StockWise',
    description: 'Choose a catalogue plan, follow an active payment channel, then submit private proof for platform review.',
    warning: 'Uploading proof does not verify payment or activate access. A StockWise platform administrator must review and approve the request.',
    plan: 'Plan and billing period', channel: 'Payment channel', expected: 'Authoritative amount', destination: 'Payment destination',
    payer: 'Payer name', phone: 'Payer phone', reference: 'Provider transaction reference', declared: 'Declared amount',
    note: 'Submission note', proof: 'Payment proof', proofHelp: 'JPEG, PNG, or PDF. Maximum 5 MiB.', submit: 'Submit for verification',
    save: 'Save draft and proof', working: 'Saving...', history: 'Request history', noHistory: 'No activation request has been created yet.',
    support: 'Contact support', status: 'Current access', refresh: 'Refresh', correction: 'Correction required', approved: 'Approved until',
    readOnly: 'Only a company OWNER or ADMIN can create or change an activation request. Other members can track its status.',
    restricted: 'This company is suspended or disabled. Proof upload cannot reactivate it; contact StockWise support.', back: 'Back to workspace',
    timeline: 'Immutable event timeline', cancel: 'Cancel request', cancelConfirm: 'Cancel this activation request? The audit history will be retained.',
  },
  pt: {
    eyebrow: 'Pedido de ativação verificado', title: 'Ativar ou renovar o StockWise',
    description: 'Escolha um plano do catálogo, siga um canal de pagamento ativo e envie o comprovativo privado para análise da plataforma.',
    warning: 'Carregar um comprovativo não verifica o pagamento nem ativa o acesso. Um administrador da plataforma StockWise deve analisar e aprovar o pedido.',
    plan: 'Plano e período de faturação', channel: 'Canal de pagamento', expected: 'Montante oficial', destination: 'Destino do pagamento',
    payer: 'Nome do pagador', phone: 'Telefone do pagador', reference: 'Referência da transação', declared: 'Montante declarado',
    note: 'Nota do pedido', proof: 'Comprovativo de pagamento', proofHelp: 'JPEG, PNG ou PDF. Máximo de 5 MiB.', submit: 'Enviar para verificação',
    save: 'Guardar rascunho e comprovativo', working: 'A guardar...', history: 'Histórico do pedido', noHistory: 'Ainda não foi criado um pedido de ativação.',
    support: 'Contactar suporte', status: 'Acesso atual', refresh: 'Atualizar', correction: 'Correção necessária', approved: 'Aprovado até',
    readOnly: 'Apenas um OWNER ou ADMIN da empresa pode criar ou alterar um pedido. Os outros membros podem acompanhar o estado.',
    restricted: 'Esta empresa está suspensa ou desativada. O comprovativo não pode reativá-la; contacte o suporte StockWise.', back: 'Voltar ao workspace',
    timeline: 'Linha temporal imutável', cancel: 'Cancelar pedido', cancelConfirm: 'Cancelar este pedido de ativação? O histórico de auditoria será preservado.',
  },
} as const

function money(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'MZN' }).format(value)
}

function statusTone(status: string) {
  if (status === 'approved') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'needs_correction') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  if (status === 'rejected' || status === 'cancelled') return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
  return 'border-border bg-muted/30 text-foreground'
}

export default function PaymentActivation() {
  const { companyId, companyName, myRole } = useOrg()
  const { lang, t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const c = copy[lang]
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN'
  const [access, setAccess] = useState<CompanyAccessState | null>(null)
  const [plans, setPlans] = useState<PaymentPlanOption[]>([])
  const [channels, setChannels] = useState<PaymentChannel[]>([])
  const [requests, setRequests] = useState<PaymentRequest[]>([])
  const [timeline, setTimeline] = useState<PaymentRequestEvent[]>([])
  const [planKey, setPlanKey] = useState('')
  const [channelId, setChannelId] = useState('')
  const [payerName, setPayerName] = useState('')
  const [payerPhone, setPayerPhone] = useState('')
  const [transactionReference, setTransactionReference] = useState('')
  const [declaredAmount, setDeclaredAmount] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const selectedPlan = useMemo(() => plans.find((plan) => `${plan.plan_code}:${plan.billing_period}` === planKey), [planKey, plans])
  const selectedChannel = useMemo(() => channels.find((channel) => channel.id === channelId), [channelId, channels])
  const openRequest = requests.find((request) => ['draft', 'submitted', 'under_review', 'needs_correction'].includes(request.status))
  const restricted = access?.effective_status === 'suspended' || access?.effective_status === 'disabled'

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const [nextAccess, nextPlans, nextChannels, nextRequests] = await Promise.all([
        getMyCompanyAccessState(companyId), paymentActivationApi.listPlans(), paymentActivationApi.listChannels(), paymentActivationApi.listRequests(companyId),
      ])
      setAccess(nextAccess)
      setPlans(nextPlans)
      setChannels(nextChannels)
      setRequests(nextRequests)
      if (nextRequests[0]) {
        const detail = await paymentActivationApi.getRequest(nextRequests[0].id)
        setTimeline(detail.events)
      } else {
        setTimeline([])
      }
      const editable = nextRequests.find((request) => ['draft', 'needs_correction'].includes(request.status))
      if (editable) {
        setPlanKey(`${editable.requested_plan_code}:${editable.billing_period_snapshot}`)
        setChannelId(editable.payment_channel_id)
        setPayerName(editable.payer_name ?? '')
        setPayerPhone(editable.payer_phone ?? '')
        setTransactionReference(editable.provider_transaction_reference ?? '')
        setDeclaredAmount(String(editable.declared_paid_amount ?? editable.expected_amount_snapshot))
        setNote(editable.company_submission_note ?? '')
      } else if (nextPlans[0] && nextChannels[0]) {
        setPlanKey(`${nextPlans[0].plan_code}:${nextPlans[0].billing_period}`)
        setChannelId(nextChannels[0].id)
        setDeclaredAmount(String(nextPlans[0].amount))
      }
    } catch (error) {
      toast.error((error as Error).message)
    } finally { setLoading(false) }
  }, [companyId])

  useEffect(() => { void load() }, [load])

  async function submit() {
    if (!companyId || !selectedPlan || !selectedChannel || !file || !canManage || restricted) return
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast.error(c.proofHelp); return
    }
    setSubmitting(true)
    try {
      let requestId = openRequest?.id
      let uploadPath = `${companyId}/${requestId}/proof`
      if (!requestId) {
        const created = await paymentActivationApi.createRequest(companyId, selectedPlan.plan_code, selectedPlan.billing_period, selectedChannel.id, createPostingRequestKey())
        requestId = created.request_id
        uploadPath = created.upload_path
      }
      await paymentActivationApi.updateDraft({ requestId, planCode: selectedPlan.plan_code, period: selectedPlan.billing_period,
        channelId: selectedChannel.id, payerName, payerPhone, transactionReference, declaredAmount: Number(declaredAmount), note, requestKey: createPostingRequestKey() })
      await paymentActivationApi.uploadProof(uploadPath, file)
      await paymentActivationApi.attachProof(requestId, createPostingRequestKey())
      await paymentActivationApi.submit(requestId, createPostingRequestKey(), openRequest?.status === 'needs_correction')
      toast.success(c.submit)
      setFile(null); if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch (error) { toast.error((error as Error).message) } finally { setSubmitting(false) }
  }

  async function cancelRequest(request: PaymentRequest) {
    if (!window.confirm(c.cancelConfirm)) return
    setSubmitting(true)
    try {
      await paymentActivationApi.cancel(request.id, 'Cancelled by company user', createPostingRequestKey())
      toast.success(c.cancel)
      await load()
    } catch (error) { toast.error((error as Error).message) } finally { setSubmitting(false) }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <BrandLockup compact />
          <Button variant="outline" asChild><Link to={access?.access_enabled ? '/settings' : '/company-access'}><ArrowLeft className="h-4 w-4" />{c.back}</Link></Button>
        </header>
        <Card className="border-border/70">
          <CardHeader className="border-b border-border/70">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{c.eyebrow}</div>
            <CardTitle className="text-2xl sm:text-3xl">{c.title}</CardTitle><CardDescription className="max-w-3xl text-base">{c.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 sm:p-6 lg:grid-cols-3">
            <div><div className="text-xs text-muted-foreground">{companyName}</div><div className="mt-1 font-semibold">{c.status}: {access?.effective_status ? tt(`paymentActivation.status.${access.effective_status}`, access.effective_status.replaceAll('_', ' ')) : '-'}</div></div>
            <div><div className="text-xs text-muted-foreground">{access?.plan_name ?? '-'}</div><div className="mt-1 font-semibold">{access?.paid_until ? new Date(access.paid_until).toLocaleDateString(locale) : '-'}</div></div>
            <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{c.refresh}</Button>
          </CardContent>
        </Card>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-800 dark:text-amber-200"><ShieldCheck className="mr-2 inline h-4 w-4" />{restricted ? c.restricted : c.warning}</div>
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.75fr)]">
          <Card className="min-w-0 border-border/70">
            <CardHeader><CardTitle>{c.save}</CardTitle><CardDescription>{!canManage ? c.readOnly : c.proofHelp}</CardDescription></CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>{c.plan}</Label><Select value={planKey} onValueChange={(value) => { setPlanKey(value); const p=plans.find((row)=>`${row.plan_code}:${row.billing_period}`===value); if(p)setDeclaredAmount(String(p.amount)) }} disabled={!canManage||!!openRequest&&!['draft','needs_correction'].includes(openRequest.status)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{plans.map((plan)=><SelectItem key={`${plan.plan_code}:${plan.billing_period}`} value={`${plan.plan_code}:${plan.billing_period}`}>{plan.display_name} · {tt(`paymentActivation.period.${plan.billing_period}`, plan.billing_period.replaceAll('_',' '))} · {money(plan.amount,locale)}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2 sm:col-span-2"><Label>{c.channel}</Label><Select value={channelId} onValueChange={setChannelId} disabled={!canManage||!!openRequest&&!['draft','needs_correction'].includes(openRequest.status)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{channels.map((channel)=><SelectItem key={channel.id} value={channel.id}>{channel.display_name}</SelectItem>)}</SelectContent></Select></div>
              {selectedChannel ? <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-4 sm:col-span-2"><div className="text-xs font-medium text-muted-foreground">{c.destination}</div><div className="mt-1 break-words font-semibold">{selectedChannel.destination_identifier}</div><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{selectedChannel.customer_instructions}</p></div>:null}
              <div className="space-y-2"><Label>{c.payer}</Label><Input value={payerName} onChange={(e)=>setPayerName(e.target.value)} disabled={!canManage} /></div>
              <div className="space-y-2"><Label>{c.phone}</Label><Input value={payerPhone} onChange={(e)=>setPayerPhone(e.target.value)} disabled={!canManage} /></div>
              <div className="space-y-2"><Label>{c.reference}</Label><Input value={transactionReference} onChange={(e)=>setTransactionReference(e.target.value)} disabled={!canManage} /></div>
              <div className="space-y-2"><Label>{c.declared}</Label><Input type="number" min="0.01" step="0.01" value={declaredAmount} onChange={(e)=>setDeclaredAmount(e.target.value)} disabled={!canManage} /></div>
              <div className="rounded-lg border border-border p-4 sm:col-span-2"><div className="text-xs text-muted-foreground">{c.expected}</div><div className="mt-1 text-xl font-semibold">{selectedPlan ? money(selectedPlan.amount,locale) : '-'}</div></div>
              <div className="space-y-2 sm:col-span-2"><Label>{c.note}</Label><Textarea value={note} onChange={(e)=>setNote(e.target.value)} disabled={!canManage} /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="payment-proof">{c.proof}</Label><Input ref={fileRef} id="payment-proof" type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e)=>setFile(e.target.files?.[0]??null)} disabled={!canManage}/><p className="text-xs text-muted-foreground">{c.proofHelp}</p></div>
              <Button className="sm:col-span-2" onClick={()=>void submit()} disabled={submitting||!canManage||restricted||!selectedPlan||!selectedChannel||!file||!payerName.trim()||!transactionReference.trim()||Number(declaredAmount)<=0||!!openRequest&&!['draft','needs_correction'].includes(openRequest.status)}><Upload className="h-4 w-4" />{submitting?c.working:c.submit}</Button>
            </CardContent>
          </Card>
          <Card className="min-w-0 border-border/70"><CardHeader><CardTitle>{c.history}</CardTitle><CardDescription>{requests.length?tt('paymentActivation.requestCount','{count} request(s)',{count:requests.length}):c.noHistory}</CardDescription></CardHeader><CardContent className="space-y-3">{requests.map((request)=><div key={request.id} className="min-w-0 rounded-lg border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="break-all font-mono text-xs text-muted-foreground">{request.reference}</div><div className="mt-1 break-words font-semibold">{request.plan_name_snapshot}</div></div><Badge variant="outline" className={statusTone(request.status)}>{tt(`paymentActivation.status.${request.status}`,request.status.replaceAll('_',' '))}</Badge></div><div className="mt-3 grid gap-2 text-sm text-muted-foreground"><span>{money(request.expected_amount_snapshot,locale)} · {request.payment_channel_display_snapshot}</span><span><Clock3 className="mr-1 inline h-3.5 w-3.5" />{new Date(request.created_at).toLocaleString(locale)}</span>{request.correction_reason?<span className="text-amber-700 dark:text-amber-300">{c.correction}: {request.correction_reason}</span>:null}{request.approved_paid_until_snapshot?<span className="text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />{c.approved}: {new Date(request.approved_paid_until_snapshot).toLocaleDateString(locale)}</span>:null}</div>{canManage&&['draft','submitted','under_review','needs_correction'].includes(request.status)?<Button className="mt-3 w-full" variant="outline" onClick={()=>void cancelRequest(request)} disabled={submitting}>{c.cancel}</Button>:null}</div>)}{!requests.length?<div className="py-8 text-center text-sm text-muted-foreground"><FileCheck2 className="mx-auto mb-3 h-8 w-8" />{c.noHistory}</div>:null}{timeline.length?<div className="rounded-lg border border-border p-4"><div className="font-semibold">{c.timeline}</div><div className="mt-3 space-y-3">{timeline.map((event)=><div key={event.id} className="flex gap-3 text-sm"><div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"/><div className="min-w-0"><div className="break-words font-medium">{tt(`paymentActivation.event.${event.event_type}`,event.event_type.replaceAll('_',' '))}</div><div className="text-xs text-muted-foreground">#{event.sequence} · {new Date(event.created_at).toLocaleString(locale)}</div>{event.reason?<div className="mt-1 break-words text-muted-foreground">{event.reason}</div>:null}</div></div>)}</div></div>:null}</CardContent></Card>
        </div>
        <div className="text-center text-sm text-muted-foreground"><a className="underline" href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>{c.support}: {PUBLIC_CONTACT_EMAIL}</a></div>
      </div>
    </div>
  )
}
