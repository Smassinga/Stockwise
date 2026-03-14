import { Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import PublicAuthShell from '../components/auth/PublicAuthShell'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { buildAuthCallbackUrl } from '../lib/authRedirect'
import { runAdminUserSyncIfNeeded } from '../lib/adminSync'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { withTimeout } from '../lib/withTimeout'

const LS_INVITE_KEY = 'sw:inviteToken'
const SESSION_LOOKUP_TIMEOUT_MS = 5000
const MEMBERSHIP_LOOKUP_TIMEOUT_MS = 6000
const BEST_EFFORT_SYNC_TIMEOUT_MS = 5000
const INVITE_REDEEM_TIMEOUT_MS = 6000
const CREATE_COMPANY_TIMEOUT_MS = 15000

const shellCopyByLang = {
  en: {
    subtitle: 'Finish company setup and start working from a clean, secure workspace.',
    heroTitle: 'Finish your workspace setup.',
    heroBody:
      'Create your first company, or let StockWise route you into an invited workspace once your membership is ready.',
    highlights: [
      'Create the first company in under a minute',
      'Invite-based memberships still route into the right company automatically',
      'You can return here safely if setup is interrupted',
    ],
    companyPlaceholder: 'Acme Trading',
    createCompanyHint:
      'This creates the first company for your account. You can add more companies later if your role allows it.',
    inviteHint:
      "If you were invited by another company, StockWise will route you there automatically as soon as the membership becomes active.",
    startupTitle: 'Could not finish setup',
    startupBody:
      'Authentication completed, but company membership data is temporarily unavailable.',
    resendDone: 'Verification email resent.',
    retry: 'Retry',
    backToSignIn: 'Back to sign-in',
    createCompanyError: 'Please enter a company name.',
    createCompanyFailed: 'Could not create company.',
  },
  pt: {
    subtitle: 'Conclua a configuracao da empresa e comece a trabalhar num workspace seguro.',
    heroTitle: 'Conclua a configuracao do seu workspace.',
    heroBody:
      'Crie a sua primeira empresa ou deixe o StockWise encaminha-lo para um workspace convidado assim que a associacao estiver pronta.',
    highlights: [
      'Crie a primeira empresa em menos de um minuto',
      'Associacoes por convite continuam a encaminhar para a empresa correta automaticamente',
      'Pode voltar a esta etapa com seguranca se a configuracao for interrompida',
    ],
    companyPlaceholder: 'Acme Comercial',
    createCompanyHint:
      'Isto cria a primeira empresa da sua conta. Pode adicionar outras empresas mais tarde se a sua funcao permitir.',
    inviteHint:
      'Se foi convidado por outra empresa, o StockWise vai encaminha-lo automaticamente assim que a associacao ficar ativa.',
    startupTitle: 'Nao foi possivel concluir a configuracao',
    startupBody:
      'A autenticacao foi concluida, mas os dados de associacao da empresa estao temporariamente indisponiveis.',
    resendDone: 'Email de verificacao reenviado.',
    retry: 'Tentar novamente',
    backToSignIn: 'Voltar ao login',
    createCompanyError: 'Introduza o nome da empresa.',
    createCompanyFailed: 'Nao foi possivel criar a empresa.',
  },
} as const

async function waitForMembership(timeoutMs = 8000, stepMs = 400) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const {
      data: { session },
    } = await withTimeout(
      supabase.auth.getSession(),
      SESSION_LOOKUP_TIMEOUT_MS,
      'membership poll session lookup'
    )
    const userId = session?.user?.id
    if (!userId) return null

    const { data } = await withTimeout(
      supabase
        .from('company_members')
        .select('company_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      MEMBERSHIP_LOOKUP_TIMEOUT_MS,
      'membership poll'
    )

    if (data?.company_id) return data.company_id
    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }
  return null
}

export default function Onboarding() {
  const { lang, t } = useI18n()
  const shellCopy = shellCopyByLang[lang]
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        setStartupError(null)

        const {
          data: { session },
        } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_LOOKUP_TIMEOUT_MS,
          'onboarding session lookup'
        )
        const user = session?.user
        if (!user) {
          nav('/login', { replace: true })
          return
        }

        const confirmed =
          (user as any)?.email_confirmed_at ||
          user?.identities?.some?.((identity) => (identity as any)?.identity_data?.email_confirmed_at)

        if (!confirmed) {
          setUnverifiedEmail(user.email ?? 'your email')
          setLoading(false)
          return
        }

        try {
          await withTimeout(
            runAdminUserSyncIfNeeded(user.id),
            BEST_EFFORT_SYNC_TIMEOUT_MS,
            'admin user sync'
          )
        } catch (e) {
          console.warn('admin user sync failed during onboarding:', e)
        }

        try {
          const token = localStorage.getItem(LS_INVITE_KEY)
          if (token) {
            await withTimeout(
              supabase.rpc('accept_invite_with_token', { p_token: token }),
              INVITE_REDEEM_TIMEOUT_MS,
              'invite redeem'
            )
            localStorage.removeItem(LS_INVITE_KEY)
          }
        } catch (e) {
          console.warn('invite token redeem failed (onboarding):', (e as any)?.message || e)
        }

        const active = await withTimeout(
          supabase
            .from('company_members')
            .select('company_id')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle(),
          MEMBERSHIP_LOOKUP_TIMEOUT_MS,
          'active membership lookup'
        )

        if (active.data?.company_id) {
          nav('/dashboard', { replace: true })
          return
        }

        setLoading(false)
      } catch (e: any) {
        console.error(e)
        const message = e?.message || t('common.headsUp')
        setStartupError(message)
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function resendVerification() {
    if (!unverifiedEmail) return
    try {
      setResending(true)
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: unverifiedEmail,
        options: { emailRedirectTo: buildAuthCallbackUrl() },
      })
      if (error) toast.error(error.message)
      else toast.success(shellCopy.resendDone)
    } finally {
      setResending(false)
    }
  }

  async function createCompany() {
    const name = companyName.trim()
    if (!name) {
      toast.error(shellCopy.createCompanyError)
      return
    }

    try {
      setCreating(true)
      const { error } = await withTimeout(
        supabase.rpc('create_company_and_bootstrap', { p_name: name }),
        CREATE_COMPANY_TIMEOUT_MS,
        'create company'
      )
      if (error) {
        toast.error(error.message)
        return
      }

      await withTimeout(
        supabase.auth.refreshSession(),
        SESSION_LOOKUP_TIMEOUT_MS,
        'refresh session'
      )

      setLoading(true)
      const companyId = await waitForMembership(8000, 400)
      if (!companyId) console.warn('Membership not visible yet; navigating anyway.')
      nav('/dashboard', { replace: true })
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || shellCopy.createCompanyFailed)
      setLoading(false)
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <PublicAuthShell
        subtitle={shellCopy.subtitle}
        heroTitle={shellCopy.heroTitle}
        heroBody={shellCopy.heroBody}
        highlights={shellCopy.highlights}
      >
        <Card className="border-border/70 bg-card/95 shadow-xl">
          <CardContent className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
            {t('loading')}
          </CardContent>
        </Card>
      </PublicAuthShell>
    )
  }

  if (startupError) {
    return (
      <PublicAuthShell
        subtitle={shellCopy.subtitle}
        heroTitle={shellCopy.heroTitle}
        heroBody={shellCopy.heroBody}
        highlights={shellCopy.highlights}
      >
        <Card className="border-border/70 bg-card/95 shadow-xl">
          <CardHeader className="space-y-3">
            <CardTitle>{shellCopy.startupTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{startupError}</p>
            <p className="text-sm text-muted-foreground">{shellCopy.startupBody}</p>
            <div className="flex gap-2">
              <Button onClick={() => window.location.reload()}>{shellCopy.retry}</Button>
              <Button variant="secondary" onClick={() => location.assign('/login')}>
                {shellCopy.backToSignIn}
              </Button>
            </div>
          </CardContent>
        </Card>
      </PublicAuthShell>
    )
  }

  if (unverifiedEmail) {
    return (
      <PublicAuthShell
        subtitle={shellCopy.subtitle}
        heroTitle={shellCopy.heroTitle}
        heroBody={shellCopy.heroBody}
        highlights={shellCopy.highlights}
      >
        <Card className="border-border/70 bg-card/95 shadow-xl">
          <CardHeader className="space-y-3">
            <CardTitle>{t('onboarding.verifyTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('onboarding.verifyDesc', { email: unverifiedEmail })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={resendVerification} disabled={resending}>
                <Mail className="mr-2 h-4 w-4" />
                {resending ? t('actions.saving') : t('onboarding.resend')}
              </Button>
              <Button variant="secondary" onClick={() => location.assign('/login')}>
                {t('onboarding.useDifferent')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('onboarding.already')}</p>
          </CardContent>
        </Card>
      </PublicAuthShell>
    )
  }

  return (
    <PublicAuthShell
      subtitle={shellCopy.subtitle}
      heroTitle={shellCopy.heroTitle}
      heroBody={shellCopy.heroBody}
      highlights={shellCopy.highlights}
    >
      <Card className="border-border/70 bg-card/95 shadow-xl">
        <CardHeader className="space-y-3 pb-4">
          <CardTitle>{t('onboarding.createCompanyTitle')}</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">{t('onboarding.notInCompany')}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
            {shellCopy.createCompanyHint}
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/70 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="companyName">{t('onboarding.companyName')}</Label>
                <Input
                  id="companyName"
                  placeholder={shellCopy.companyPlaceholder}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createCompany()
                  }}
                />
              </div>
              <Button onClick={createCompany} disabled={creating || !companyName.trim()} className="sm:min-w-[160px]">
                {creating ? t('actions.saving') : t('onboarding.create')}
              </Button>
            </div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{shellCopy.inviteHint}</p>
        </CardContent>
      </Card>
    </PublicAuthShell>
  )
}
