import { AlertCircle, Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import PublicAuthShell from '../components/auth/PublicAuthShell'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { buildAuthCallbackUrl } from '../lib/authRedirect'
import { clearInviteToken, readInviteToken } from '../lib/inviteToken'
import { runAdminUserSyncIfNeeded } from '../lib/adminSync'
import { getPlatformAdminStatus } from '../lib/companyAccess'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { setActiveCompanyRpc } from '../lib/setActiveCompanyRpc'
import { withTimeout } from '../lib/withTimeout'

const SESSION_LOOKUP_TIMEOUT_MS = 5000
const MEMBERSHIP_LOOKUP_TIMEOUT_MS = 6000
const BEST_EFFORT_SYNC_TIMEOUT_MS = 5000
const INVITE_REDEEM_TIMEOUT_MS = 6000
const CREATE_COMPANY_TIMEOUT_MS = 15000
const SET_ACTIVE_COMPANY_TIMEOUT_MS = 6000
const isDev = import.meta.env.DEV

type BootstrapCompanyResult = {
  out_company_id?: string | null
  company_name?: string | null
  out_role?: string | null
}

const shellCopyByLang = {
  en: {
    subtitle: 'Start the first company on a controlled 7-day trial and keep manual plan activation for later.',
    heroTitle: 'Finish your workspace setup.',
    heroBody:
      'Create your first company, start the 7-day trial, or let StockWise route you into an invited workspace once your membership is ready.',
    highlights: [
      'Create the first company in under a minute',
      'The first company starts on a 7-day operational trial',
      'Invite-based memberships still route into the right company automatically',
      'Manual paid activation remains controlled by the StockWise team',
    ],
    companyPlaceholder: 'Company legal name',
    createCompanyHint:
      'This creates the first company for your account and starts the 7-day trial. Paid access is still manually granted by the StockWise team after trial.',
    inviteHint:
      "If you were invited by another company, StockWise will route you there automatically as soon as the membership becomes active.",
    companyLabelHint: 'You can rename company details later from settings.',
    startupTitle: 'Could not finish setup',
    startupBody:
      'Authentication completed, but company membership data is temporarily unavailable.',
    startupRetryHint: 'Refresh once, or sign in again if the session has expired.',
    resendDone: 'Verification email resent.',
    retry: 'Retry',
    backToSignIn: 'Back to sign-in',
    createCompanyError: 'Please enter a company name.',
    createCompanyFailed: 'Could not create company.',
    createCompanyFailedBody:
      'We could not finish the company setup right now. Please review the company name and try again.',
    createCompanyTimeout:
      'Company setup is taking longer than expected. Please try again in a moment.',
    createCompanyRateLimited:
      'Too many workspace bootstrap attempts were made too quickly. Wait a bit before trying again.',
    createCompanySessionExpired: 'Your session expired. Sign in again to continue.',
    createCompanyResponseError: 'Company setup finished without a usable company record. Please try again.',
    createCompanyCta: 'Create company',
    creatingCompany: 'Creating company...',
  },
  pt: {
    subtitle: 'Crie a primeira empresa num teste controlado de 7 dias e mantenha a ativação paga manual para mais tarde.',
    heroTitle: 'Conclua a configuração do seu workspace.',
    heroBody:
      'Crie a sua primeira empresa, inicie o teste de 7 dias ou deixe o StockWise encaminhá-lo para um workspace convidado assim que a associação estiver pronta.',
    highlights: [
      'Crie a primeira empresa em menos de um minuto',
      'A primeira empresa começa com um teste operacional de 7 dias',
      'Associações por convite continuam a encaminhar para a empresa correta automaticamente',
      'A ativação paga continua manual pela equipa StockWise',
    ],
    companyPlaceholder: 'Nome legal da empresa',
    createCompanyHint:
      'Isto cria a primeira empresa da sua conta e inicia o teste de 7 dias. O acesso pago continua a ser ativado manualmente pela equipa StockWise depois do teste.',
    inviteHint:
      'Se foi convidado por outra empresa, o StockWise vai encaminhá-lo automaticamente assim que a associação ficar ativa.',
    companyLabelHint: 'Mais tarde pode atualizar os detalhes da empresa nas definições.',
    startupTitle: 'Não foi possível concluir a configuração',
    startupBody:
      'A autenticação foi concluída, mas os dados de associação da empresa estão temporariamente indisponíveis.',
    startupRetryHint: 'Atualize a página uma vez ou volte a entrar se a sessão tiver expirado.',
    resendDone: 'E-mail de verificação reenviado.',
    retry: 'Tentar novamente',
    backToSignIn: 'Voltar ao login',
    createCompanyError: 'Introduza o nome da empresa.',
    createCompanyFailed: 'Não foi possível criar a empresa.',
    createCompanyFailedBody:
      'Não foi possível concluir a configuração da empresa agora. Reveja o nome e tente novamente.',
    createCompanyTimeout:
      'A configuração da empresa está a demorar mais do que o esperado. Tente novamente dentro de instantes.',
    createCompanyRateLimited:
      'Foram feitas demasiadas tentativas de criação de workspace num curto espaço de tempo. Aguarde um pouco antes de tentar novamente.',
    createCompanySessionExpired: 'A sua sessão expirou. Volte a iniciar sessão para continuar.',
    createCompanyResponseError:
      'A configuração terminou sem devolver uma empresa válida. Tente novamente.',
    createCompanyCta: 'Criar empresa',
    creatingCompany: 'A criar empresa...',
  },
} as const

function rememberCompanyLocally(companyId: string | null) {
  if (!companyId || typeof window === 'undefined') return
  localStorage.setItem('sw:lastCompanyId:temp', companyId)
}

function unwrapBootstrapCompany(payload: unknown): BootstrapCompanyResult | null {
  if (Array.isArray(payload)) {
    return (payload[0] as BootstrapCompanyResult | undefined) ?? null
  }
  if (payload && typeof payload === 'object') {
    return payload as BootstrapCompanyResult
  }
  return null
}

function getFriendlyStartupError(
  copy: (typeof shellCopyByLang)['en'],
  error: { message?: string } | null | undefined,
) {
  const message = (error?.message || '').toLowerCase()
  if (message.includes('timed out')) return copy.startupBody
  if (message.includes('not_authenticated')) return copy.createCompanySessionExpired
  return copy.startupBody
}

function getFriendlyCreateCompanyError(
  copy: (typeof shellCopyByLang)['en'],
  error: { message?: string; code?: string } | null | undefined,
) {
  const message = (error?.message || '').toLowerCase()
  if (message.includes('timed out')) return copy.createCompanyTimeout
  if (message.includes('not_authenticated')) return copy.createCompanySessionExpired
  if (message.includes('company_bootstrap_rate_limited')) return copy.createCompanyRateLimited
  if (message.includes('bootstrap_error') || error?.code === 'P0001') return copy.createCompanyFailed
  return copy.createCompanyFailed
}

async function waitForMembership(timeoutMs = 8000, stepMs = 400) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const {
      data: { session },
    } = await withTimeout(
      supabase.auth.getSession(),
      SESSION_LOOKUP_TIMEOUT_MS,
      'membership poll session lookup',
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
      'membership poll',
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
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        setStartupError(null)
        setSubmitError(null)

        const {
          data: { session },
        } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_LOOKUP_TIMEOUT_MS,
          'onboarding session lookup',
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
            'admin user sync',
          )
        } catch (e) {
          console.warn('admin user sync failed during onboarding:', e)
        }

        try {
          const token = readInviteToken()
          if (token) {
            await withTimeout(
              supabase.rpc('accept_invite_with_token', { p_token: token }),
              INVITE_REDEEM_TIMEOUT_MS,
              'invite redeem',
            )
            clearInviteToken()
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
          'active membership lookup',
        )

        if (active.data?.company_id) {
          rememberCompanyLocally(active.data.company_id)
          nav('/dashboard', { replace: true })
          return
        }

        const adminStatus = await getPlatformAdminStatus().catch(() => ({ is_admin: false }))
        if (adminStatus?.is_admin) {
          nav('/platform-control', { replace: true })
          return
        }

        setLoading(false)
      } catch (e: any) {
        if (isDev) {
          console.warn('[Onboarding] startup failed', e)
        }
        setStartupError(getFriendlyStartupError(shellCopy, e))
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
      setSubmitError(shellCopy.createCompanyError)
      toast.error(shellCopy.createCompanyError)
      return
    }

    try {
      setCreating(true)
      setSubmitError(null)
      const { data, error } = await withTimeout(
        supabase.rpc('create_company_and_bootstrap', { p_name: name }),
        CREATE_COMPANY_TIMEOUT_MS,
        'create company',
      )
      if (error) {
        const friendly = getFriendlyCreateCompanyError(shellCopy, error)
        if (isDev) {
          console.warn('[Onboarding] create_company_and_bootstrap failed', {
            companyName: name,
            code: error.code,
            message: error.message,
            details: (error as any).details,
            hint: (error as any).hint,
          })
        }
        setSubmitError(friendly)
        toast.error(friendly)
        return
      }

      const bootstrap = unwrapBootstrapCompany(data)
      const companyId = bootstrap?.out_company_id ?? null
      if (!companyId) {
        setSubmitError(shellCopy.createCompanyResponseError)
        toast.error(shellCopy.createCompanyResponseError)
        return
      }

      rememberCompanyLocally(companyId)

      const { error: activeErr } = await withTimeout(
        setActiveCompanyRpc(companyId),
        SET_ACTIVE_COMPANY_TIMEOUT_MS,
        'set active company',
      )
      if (activeErr && isDev) {
        console.warn('[Onboarding] set_active_company after bootstrap failed', {
          companyId,
          code: activeErr.code,
          message: activeErr.message,
          details: (activeErr as any).details,
          hint: (activeErr as any).hint,
        })
      }

      try {
        await withTimeout(
          supabase.auth.refreshSession(),
          SESSION_LOOKUP_TIMEOUT_MS,
          'refresh session',
        )
      } catch (refreshError) {
        if (isDev) console.warn('[Onboarding] refreshSession after bootstrap failed', refreshError)
      }

      setLoading(true)
      const visibleCompanyId = await waitForMembership(8000, 400)
      if (visibleCompanyId) {
        rememberCompanyLocally(visibleCompanyId)
      } else if (isDev) {
        console.warn('[Onboarding] membership not visible yet after company bootstrap', { companyId })
      }
      nav('/dashboard', { replace: true })
    } catch (e: any) {
      if (isDev) {
        console.warn('[Onboarding] create company request crashed', e)
      }
      const friendly = getFriendlyCreateCompanyError(shellCopy, e)
      setSubmitError(friendly)
      toast.error(friendly)
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
            <p className="text-sm text-muted-foreground">{shellCopy.startupRetryHint}</p>
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
          {submitError ? (
            <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="rounded-2xl border border-border/70 bg-background/70 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="companyName">{t('onboarding.companyName')}</Label>
                <Input
                  id="companyName"
                  placeholder={shellCopy.companyPlaceholder}
                  value={companyName}
                  autoFocus
                  disabled={creating}
                  onChange={(e) => {
                    setCompanyName(e.target.value)
                    if (submitError) setSubmitError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createCompany()
                  }}
                />
                <p className="text-xs text-muted-foreground">{shellCopy.companyLabelHint}</p>
              </div>
              <Button
                onClick={createCompany}
                disabled={creating || !companyName.trim()}
                className="sm:min-w-[160px]"
              >
                {creating ? shellCopy.creatingCompany : shellCopy.createCompanyCta}
              </Button>
            </div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{shellCopy.inviteHint}</p>
        </CardContent>
      </Card>
    </PublicAuthShell>
  )
}


