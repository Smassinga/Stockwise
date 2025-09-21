import { useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { X, UploadCloud } from 'lucide-react'
import toast from 'react-hot-toast'

type Props = {
  value: string
  onChange: (url: string) => void
  companyId?: string | null
  disabled?: boolean
}

const isValidHttpUrl = (s: string) => {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' } catch { return false }
}

export default function LogoUploader({ value, onChange, companyId, disabled }: Props) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const onFilePick = () => fileRef.current?.click()

  const upload = async (f: File) => {
    if (!companyId) { toast.error('Missing company id'); return }
    if (!f.type.startsWith('image/')) { toast.error('Please select an image'); return }

    try {
      setBusy(true)
      const ext = f.name.split('.').pop()?.toLowerCase() || 'png'
      const key = `${companyId}/${crypto.randomUUID()}.${ext}`

      const { error: upErr } = await supabase.storage.from('brand-logos').upload(key, f, {
        cacheControl: '31536000',
        upsert: false,
        contentType: f.type,
      })
      if (upErr) throw upErr

      const { data: pub } = supabase.storage.from('brand-logos').getPublicUrl(key)
      const publicUrl = pub?.publicUrl
      if (!publicUrl) throw new Error('Could not resolve public URL')

      onChange(publicUrl)
      toast.success('Logo uploaded')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const pasteUrl = (s: string) => {
    if (!s) { onChange(''); return }
    if (!isValidHttpUrl(s)) { toast.error('Invalid URL'); return }
    onChange(s)
  }

  const clear = () => onChange('')

  return (
    <div className="space-y-2">
      <Label>Logo URL</Label>
      <div className="flex gap-2">
        <Input
          placeholder="https://…/logo.png"
          value={value || ''}
          onChange={(e) => pasteUrl(e.target.value)}
          disabled={disabled || busy}
        />
        <Button type="button" variant="secondary" onClick={onFilePick} disabled={disabled || busy}>
          <UploadCloud className="w-4 h-4 mr-2" /> Upload
        </Button>
        {value && (
          <Button type="button" variant="ghost" onClick={clear} disabled={disabled || busy} title="Clear">
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
          e.currentTarget.value = ''
        }}
      />

      {/* Preview */}
      <div className="mt-2">
        {value ? (
          <div className="flex items-center gap-3">
            <img
              src={value}
              alt="Company logo preview"
              className="h-10 w-auto rounded-md border border-border bg-card p-1"
              onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; toast.error('Logo URL not reachable') }}
            />
            <span className="text-xs text-muted-foreground truncate max-w-[60ch]">{value}</span>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No logo set</div>
        )}
      </div>
    </div>
  )
}
