import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { MailCheck, RefreshCw, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

type Template = { key: string; version: number; languages: string[] }
type Preview = { subject: string; html: string; text: string }
type Dispatch = { id: string; template_key: string; template_version: number; language: string; recipient: string; subject: string; status: string; created_at: string }

export function EmailTemplateLab({ language }: { language: 'en' | 'pt' }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateKey, setTemplateKey] = useState('member_invite')
  const [previewLanguage, setPreviewLanguage] = useState<'en' | 'pt'>(language)
  const [recipient, setRecipient] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [dispatches, setDispatches] = useState<Dispatch[]>([])
  const [busy, setBusy] = useState(false)
  const copy = language === 'pt'
    ? { title: 'Laboratório de modelos de email', help: 'Pré-visualize modelos versionados com dados sintéticos e envie apenas para um destinatário QA autorizado.', template: 'Modelo', lang: 'Idioma', recipient: 'Destinatário QA', preview: 'Pré-visualizar', send: 'Enviar teste QA', html: 'Pré-visualização HTML', plain: 'Texto simples', recent: 'Envios de teste recentes', refresh: 'Actualizar', accepted: 'Aceite pelo SMTP do Brevo' }
    : { title: 'Email Template Lab', help: 'Preview versioned templates with synthetic data and send only to an authorised QA recipient.', template: 'Template', lang: 'Language', recipient: 'QA recipient', preview: 'Preview', send: 'Send QA test', html: 'HTML preview', plain: 'Plain text', recent: 'Recent test dispatches', refresh: 'Refresh', accepted: 'Accepted by Brevo SMTP' }

  async function invoke(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke('email-template-lab', { body })
    if (error) throw error
    return data
  }
  async function load() {
    const [list, recent] = await Promise.all([invoke({ mode: 'list' }), invoke({ mode: 'recent' })])
    setTemplates(list.templates || []); setDispatches(recent.dispatches || [])
  }
  useEffect(() => { void load().catch(() => undefined) }, [])
  async function render() {
    setBusy(true)
    try { const data = await invoke({ mode: 'preview', template_key: templateKey, language: previewLanguage }); setPreview(data.rendered) }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  async function send() {
    setBusy(true)
    try { const data = await invoke({ mode: 'send', template_key: templateKey, language: previewLanguage, recipient }); toast.success(`${copy.accepted}${data.providerMessageId ? ` · ${data.providerMessageId}` : ''}`); await load() }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><MailCheck className="h-5 w-5" />{copy.title}</CardTitle><CardDescription>{copy.help}</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 md:grid-cols-4 md:items-end"><div><Label>{copy.template}</Label><Select value={templateKey} onValueChange={setTemplateKey}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{templates.map((template) => <SelectItem key={template.key} value={template.key}>{template.key} · v{template.version}</SelectItem>)}</SelectContent></Select></div><div><Label>{copy.lang}</Label><Select value={previewLanguage} onValueChange={(value) => setPreviewLanguage(value as 'en' | 'pt')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="pt">Português</SelectItem></SelectContent></Select></div><div><Label>{copy.recipient}</Label><Input type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="qa@example.com" /></div><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void render()}>{copy.preview}</Button><Button disabled={busy || !recipient} onClick={() => void send()}><Send className="mr-2 h-4 w-4" />{copy.send}</Button></div></div>{preview ? <div className="grid gap-4 lg:grid-cols-2"><div><h3 className="mb-2 font-semibold">{copy.html}</h3><div className="rounded-xl border bg-white p-2"><iframe title={copy.html} className="h-[520px] w-full" srcDoc={preview.html} sandbox="allow-popups" /></div></div><div><h3 className="mb-2 font-semibold">{copy.plain}</h3><pre className="h-[520px] overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/30 p-4 text-xs">{preview.text}</pre></div></div> : null}<div><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">{copy.recent}</h3><Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />{copy.refresh}</Button></div><div className="space-y-2">{dispatches.slice(0,10).map((row) => <div key={row.id} className="grid gap-1 rounded-lg border p-3 text-xs md:grid-cols-[1fr_auto_auto]"><div><div className="font-semibold">{row.subject}</div><div className="text-muted-foreground">{row.recipient} · {row.template_key} v{row.template_version} · {row.language}</div></div><div>{row.status}</div><div>{new Date(row.created_at).toLocaleString()}</div></div>)}</div></div></CardContent></Card>
}
