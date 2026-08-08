import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Building2, Loader2, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import LocaleToggle from '../components/LocaleToggle'
import { PremiumSkeleton } from '../components/premium/PremiumSkeleton'
import ThemeToggle from '../components/ThemeToggle'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../hooks/useOrg'
import { useI18n } from '../lib/i18n'
import { PUBLIC_CONTACT_EMAIL, buildPublicMailto } from '../lib/publicContact'
import { supabase } from '../lib/supabase'

function normalizeProfilePhone(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function isMissingProfilePhoneColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = String(error?.message || '').toLowerCase()
  return error?.code === '42703' || message.includes('phone_number')
}

function isProfileWritePermissionError(error: { message?: string; code?: string } | null | undefined) {
  const message = String(error?.message || '').toLowerCase()
  return error?.code === '42501' || message.includes('permission denied')
}

const copyByLang = {
  en: {
    title: 'Your profile',
    identity: 'Account identity',
    activeCompany: 'Active company',
    companyRole: 'Company role',
    noCompany: 'No active company',
    email: 'Account email',
    emailHelp: 'This is the email used for sign-in and secure account messages.',
    name: 'Display name',
    phone: 'Phone',
    phonePlaceholder: '+258 ...',
    phoneHelp: 'Optional profile contact. It is not an authentication factor.',
    save: 'Save profile',
    saving: 'Saving profile...',
    updated: 'Profile updated.',
    updateFailed: 'We could not save your profile right now. Please try again.',
    loadFailed: 'Some profile details could not be loaded. You can retry by refreshing this page.',
    preferences: 'Language and appearance',
    security: 'Account security',
    securityBody: 'StockWise sends a secure email link before a password can be changed.',
    passwordAction: 'Send password change link',
    sending: 'Sending secure link...',
    passwordSent: 'Password change link sent. Check your inbox.',
    passwordFailed: 'We could not send the password change link right now. Please try again.',
    companySettings: 'Company settings',
    companySettingsBody: 'Legal, document, banking, stock, and readiness settings belong to the active company.',
    reviewCompany: 'Review company setup',
    support: 'Support',
    supportBody: 'Contact StockWise support if your identity, company access, or security flow is blocked.',
    contactSupport: 'Email support',
    loading: 'Loading profile and company context',
  },
  pt: {
    title: 'O seu perfil',
    identity: 'Identidade da conta',
    activeCompany: 'Empresa ativa',
    companyRole: 'Função na empresa',
    noCompany: 'Sem empresa ativa',
    email: 'Email da conta',
    emailHelp: 'Este é o email usado para iniciar sessão e receber mensagens seguras da conta.',
    name: 'Nome de apresentação',
    phone: 'Telefone',
    phonePlaceholder: '+258 ...',
    phoneHelp: 'Contacto opcional do perfil. Não é um fator de autenticação.',
    save: 'Guardar perfil',
    saving: 'A guardar perfil...',
    updated: 'Perfil atualizado.',
    updateFailed: 'Não foi possível guardar o perfil agora. Tente novamente.',
    loadFailed: 'Não foi possível carregar alguns dados do perfil. Pode tentar novamente atualizando a página.',
    preferences: 'Idioma e aparência',
    security: 'Segurança da conta',
    securityBody: 'O StockWise envia um link seguro por email antes de permitir alterar a palavra-passe.',
    passwordAction: 'Enviar link para alterar palavra-passe',
    sending: 'A enviar link seguro...',
    passwordSent: 'Link de alteração enviado. Verifique a caixa de entrada.',
    passwordFailed: 'Não foi possível enviar agora o link de alteração. Tente novamente.',
    companySettings: 'Definições da empresa',
    companySettingsBody: 'Dados legais, documentos, bancos, stock e prontidão pertencem à empresa ativa.',
    reviewCompany: 'Rever configuração da empresa',
    support: 'Suporte',
    supportBody: 'Contacte o suporte StockWise se a identidade, o acesso à empresa ou a segurança estiverem bloqueados.',
    contactSupport: 'Enviar email ao suporte',
    loading: 'A carregar perfil e contexto da empresa',
  },
} as const

const roleLabels = {
  OWNER: { en: 'Owner', pt: 'Proprietário' },
  ADMIN: { en: 'Administrator', pt: 'Administrador' },
  MANAGER: { en: 'Manager', pt: 'Gestor' },
  OPERATOR: { en: 'Operator', pt: 'Operador' },
  VIEWER: { en: 'Viewer', pt: 'Leitor' },
} as const

export default function Profile() {
  const { user, requestPasswordReset } = useAuth()
  const { lang } = useI18n()
  const copy = copyByLang[lang]
  const { companyName, myRole, loading: orgLoading } = useOrg()
  const [displayName, setDisplayName] = useState(user?.name || '')
  const [phone, setPhone] = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)

  const initials = useMemo(() => {
    const source = displayName.trim() || user?.email || 'SW'
    return source.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
  }, [displayName, user?.email])

  useEffect(() => {
    let cancelled = false

    const loadProfile = async () => {
      if (!user) {
        setProfileLoading(false)
        return
      }

      setProfileLoading(true)
      setLoadError(false)
      try {
        const { data: { user: userData }, error } = await supabase.auth.getUser()
        if (error) throw error
        if (!userData || cancelled) return

        const metadataName = userData.user_metadata?.name || userData.user_metadata?.full_name || user.name || ''
        const metadataPhone = userData.user_metadata?.phone_number || userData.user_metadata?.phone || ''
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('name,full_name,phone_number')
          .eq('id', user.id)
          .maybeSingle()

        if (profileError && isMissingProfilePhoneColumn(profileError)) {
          const { data: fallbackProfile, error: fallbackError } = await supabase
            .from('profiles')
            .select('name,full_name')
            .eq('id', user.id)
            .maybeSingle()
          if (fallbackError) console.warn('Profile fallback lookup failed:', fallbackError.message)
          if (!cancelled) {
            setDisplayName(fallbackProfile?.full_name || fallbackProfile?.name || metadataName)
            setPhone(metadataPhone)
            setLoadError(Boolean(fallbackError))
          }
          return
        }

        if (profileError) throw profileError
        if (!cancelled) {
          setDisplayName(profile?.full_name || profile?.name || metadataName)
          setPhone(profile?.phone_number || metadataPhone)
        }
      } catch (error) {
        console.error('Error loading profile:', error)
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    }

    void loadProfile()
    return () => { cancelled = true }
  }, [user])

  const handleUpdateProfile = async () => {
    if (!user) return
    setSaving(true)
    try {
      const cleanPhone = normalizeProfilePhone(phone)
      const cleanName = displayName.trim()
      const { error } = await supabase.auth.updateUser({
        data: { name: cleanName, full_name: cleanName, phone_number: cleanPhone || null },
      })
      if (error) throw error

      const { error: profileError } = await supabase.from('profiles').upsert({
        id: user.id,
        user_id: user.id,
        name: cleanName || null,
        full_name: cleanName || null,
        phone_number: cleanPhone || null,
      }, { onConflict: 'id' })

      if (profileError && isMissingProfilePhoneColumn(profileError)) {
        const { error: fallbackError } = await supabase.from('profiles').upsert({
          id: user.id,
          user_id: user.id,
          name: cleanName || null,
          full_name: cleanName || null,
        }, { onConflict: 'id' })
        if (fallbackError && !isProfileWritePermissionError(fallbackError)) throw fallbackError
        if (fallbackError) console.info('Optional Profile mirror write skipped; Auth metadata remains authoritative:', fallbackError.message)
      } else if (profileError && isProfileWritePermissionError(profileError)) {
        console.info('Optional Profile mirror write skipped; Auth metadata remains authoritative:', profileError.message)
      } else if (profileError) {
        throw profileError
      }

      toast.success(copy.updated)
    } catch (error) {
      console.error('Profile update error:', error)
      toast.error(copy.updateFailed)
    } finally {
      setSaving(false)
    }
  }

  const handlePasswordReset = async () => {
    if (!user?.email) return
    setPasswordLoading(true)
    try {
      const result = await requestPasswordReset(user.email)
      if (!result.success) throw new Error(result.error)
      toast.success(copy.passwordSent)
    } catch (error) {
      console.error('Password reset error:', error)
      toast.error(copy.passwordFailed)
    } finally {
      setPasswordLoading(false)
    }
  }

  if (profileLoading || orgLoading) {
    return <PremiumSkeleton variant="detail" lines={4} label={copy.loading} />
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="border-b border-border pb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{copy.title}</h1>
      </header>

      {loadError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{copy.loadFailed}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="profile-identity-heading" className="grid gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <div>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground" aria-hidden="true">
            {initials}
          </div>
          <h2 id="profile-identity-heading" className="mt-4 text-xl font-semibold text-foreground">{copy.identity}</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{copy.activeCompany}</dt>
              <dd className="mt-1 flex items-center gap-2 font-medium text-foreground"><Building2 className="h-4 w-4" aria-hidden="true" />{companyName || copy.noCompany}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.companyRole}</dt>
              <dd className="mt-1 font-medium text-foreground">{myRole ? roleLabels[myRole]?.[lang] || myRole : '—'}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-5 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <div className="space-y-2">
            <Label htmlFor="profile-email">{copy.email}</Label>
            <Input id="profile-email" value={user?.email || ''} disabled />
            <p className="text-xs leading-5 text-muted-foreground">{copy.emailHelp}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="display-name">{copy.name}</Label>
            <Input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-phone">{copy.phone}</Label>
            <Input id="profile-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={copy.phonePlaceholder} autoComplete="tel" />
            <p className="text-xs leading-5 text-muted-foreground">{copy.phoneHelp}</p>
          </div>
          <Button onClick={() => void handleUpdateProfile()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UserRound className="h-4 w-4" aria-hidden="true" />}
            {saving ? copy.saving : copy.save}
          </Button>
        </div>
      </section>

      <section aria-labelledby="profile-preferences-heading" className="grid gap-5 border-t border-border pt-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <h2 id="profile-preferences-heading" className="text-xl font-semibold text-foreground">{copy.preferences}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3"><LocaleToggle /><ThemeToggle /></div>
      </section>

      <section aria-labelledby="profile-security-heading" className="grid gap-5 border-t border-border pt-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <h2 id="profile-security-heading" className="flex items-center gap-2 text-xl font-semibold text-foreground"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />{copy.security}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.securityBody}</p>
        </div>
        <Button variant="outline" onClick={() => void handlePasswordReset()} disabled={passwordLoading}>
          {passwordLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
          {passwordLoading ? copy.sending : copy.passwordAction}
        </Button>
      </section>

      <section className="grid gap-6 border-t border-border pt-7 md:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{copy.companySettings}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.companySettingsBody}</p>
          <Button asChild variant="link" className="mt-2 h-auto px-0"><Link to="/settings?view=setup">{copy.reviewCompany}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">{copy.support}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.supportBody}</p>
          <Button asChild variant="link" className="mt-2 h-auto px-0"><a href={buildPublicMailto('StockWise account support')}>{copy.contactSupport}: {PUBLIC_CONTACT_EMAIL}<ArrowRight className="h-4 w-4" aria-hidden="true" /></a></Button>
        </div>
      </section>
    </div>
  )
}
