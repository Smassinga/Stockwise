import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  Info,
  Loader2,
  Mail,
  Search,
  Settings2,
  UserPlus,
  Users,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import PublicAuthShell from '../components/auth/PublicAuthShell'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Progress } from '../components/ui/progress'
import { ScrollArea } from '../components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'
import { runAdminUserSyncIfNeeded } from '../lib/adminSync'
import { buildAuthCallbackUrl } from '../lib/authRedirect'
import { rememberCompanyLocally } from '../lib/companySelectionMemory'
import { getPlatformAdminStatus } from '../lib/companyAccess'
import { type MemberRole } from '../lib/enums'
import { useI18n } from '../lib/i18n'
import {
  acceptPendingCompanyInvitation,
  getInviteErrorCode,
  listMyPendingCompanyInvitations,
  type PendingCompanyInvitation,
} from '../lib/onboardingInvites'
import { setActiveCompanyRpc } from '../lib/setActiveCompanyRpc'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { withTimeout } from '../lib/withTimeout'

const SESSION_LOOKUP_TIMEOUT_MS = 5000
const MEMBERSHIP_LOOKUP_TIMEOUT_MS = 6000
const BEST_EFFORT_SYNC_TIMEOUT_MS = 5000
const CREATE_COMPANY_TIMEOUT_MS = 15000
const SET_ACTIVE_COMPANY_TIMEOUT_MS = 6000
const isDev = import.meta.env.DEV

type BootstrapCompanyResult = {
  out_company_id?: string | null
  company_name?: string | null
  out_role?: string | null
}

type CompletionState = {
  companyId: string
  companyName: string
}

const copyByLang = {
  en: {
    subtitle: 'Secure onboarding keeps company access intentional from the first sign-in.',
    heroTitle: 'Finish setting up your StockWise workspace.',
    heroBody:
      'Join an invited company or create a new one without filling every legal and fiscal detail upfront. The rest can be completed later in Settings.',
    highlights: [
      'Choose between joining an invited company and creating a new one',
      'Minimal company setup first, deeper profile completion later',
      'Invitation acceptance stays bound to the correct invited account',
      'Next-step actions stay visible after the first company is ready',
    ],
    progressLabel: 'Onboarding progress',
    progressChoose: 'Choose your workspace path',
    progressCreate: 'Add the minimum company details',
    progressReady: 'Workspace ready for next steps',
    unverifiedBody: (email: string) =>
      `We sent a verification link to ${email}. Open it in the same browser to finish signing in.`,
    verifyTitle: 'Verify your email',
    resend: 'Resend verification',
    useDifferent: 'Use a different email',
    alreadyVerified: 'Already verified? Refresh this page after clicking the link.',
    resendDone: 'Verification email resent.',
    retry: 'Retry',
    backToSignIn: 'Back to sign-in',
    createCompanyError: 'Please enter a company name.',
    createCompanyFailed: 'Could not create company.',
    createCompanyFailedBody:
      'We could not finish the company setup right now. Review the company name and try again.',
    createCompanyTimeout:
      'Company setup is taking longer than expected. Please try again in a moment.',
    createCompanyRateLimited:
      'Too many workspace bootstrap attempts were made too quickly. Wait a bit before trying again.',
    createCompanySessionExpired: 'Your session expired. Sign in again to continue.',
    createCompanyResponseError: 'Company setup finished without a usable company record. Please try again.',
    companyCreatedToast: 'Company created successfully.',
    inviteAcceptedToast: (companyName: string) =>
      `Invitation accepted. Entering ${companyName || 'your company'} now.`,
    choiceTitle: 'Choose how you want to start',
    choiceBody:
      'You already have at least one pending invitation. Join it now, or keep the invitation for later and create your own company instead.',
    joinPathTitle: 'Join invited company',
    joinPathBody: 'Use the invitation already addressed to your account and enter the correct company context.',
    joinPathHint: 'Recommended when a team already invited you.',
    createPathTitle: 'Create new company',
    createPathBody: 'Start a new company with only the minimum details now and finish the full profile later.',
    createPathHint: 'Your pending invitations remain available if you choose this path.',
    invitationsTitle: 'Pending invitations',
    invitationsBody:
      'Only invitations tied to your current account email appear here. Accepting one activates the corresponding membership.',
    invitationStatusPending: 'Pending',
    invitedRole: 'Invited role',
    invitedBy: 'Invited by',
    invitedOn: 'Invited on',
    expiresOn: 'Expires on',
    fallbackInviter: 'Company admin',
    acceptInvite: 'Accept invitation',
    createInstead: 'Create company instead',
    inviteSearchPlaceholder: 'Search invitations',
    noInviteSearchResults: 'No invitations match that search.',
    noInvitesTitle: 'Create your first company',
    noInvitesBody:
      'There are no pending invitations for this account, so you can start directly with a new company.',
    createTitle: 'Create a company',
    createBody:
      'Only the company name is required right now. Fiscal identity, address, contacts, bank details, and branding can be completed later in Settings.',
    companyNameLabel: 'Company name',
    companyPlaceholder: 'Company name',
    companyLabelHint: 'Use the trading or legal name customers will recognize first.',
    finishLaterLabel: 'Complete the full profile later',
    finishLaterTooltip:
      'Settings covers legal identity, address, contacts, logo, bank details, tax details, and other advanced company setup.',
    createCompanyCta: 'Create company',
    creatingCompany: 'Creating company...',
    readyTitle: 'Your workspace is ready',
    readyBody:
      'Continue to the dashboard now, or finish the company profile and opening setup before you start posting live activity.',
    readySummaryLabel: 'Company created',
    continueDashboard: 'Continue to dashboard',
    completeProfile: 'Complete company profile',
    importOpeningData: 'Import opening data',
    addItems: 'Add items',
    inviteUsers: 'Invite users',
    startupTitle: 'Could not finish setup',
    startupBody:
      'Authentication completed, but onboarding data is temporarily unavailable.',
    startupRetryHint: 'Refresh once, or sign in again if the session has expired.',
    inviteInvalidOrExpired:
      'This invitation is no longer valid. Ask the company administrator to send a fresh one.',
    inviteWrongEmail:
      'This invitation belongs to another email address. Sign in with the invited account to continue.',
    inviteNotFound:
      'We could not find a pending invitation for this company on your account.',
    inviteGenericError: 'We could not accept the invitation right now. Please try again.',
    returningInviteHint:
      'You can switch back to the invite path later. Creating a company does not delete your pending invitations.',
  },
  pt: {
    subtitle: 'Um onboarding seguro mantém o acesso à empresa intencional desde o primeiro login.',
    heroTitle: 'Conclua a configuração do seu workspace StockWise.',
    heroBody:
      'Entre numa empresa convidada ou crie uma nova sem preencher já todos os dados legais e fiscais. O restante pode ser concluído mais tarde nas Definições.',
    highlights: [
      'Escolha entre entrar numa empresa convidada e criar uma nova',
      'Primeiro uma configuração mínima da empresa, depois o perfil completo',
      'A aceitação do convite continua ligada à conta convidada correta',
      'Os próximos passos continuam visíveis depois da primeira empresa ficar pronta',
    ],
    progressLabel: 'Progresso do onboarding',
    progressChoose: 'Escolha o caminho do seu workspace',
    progressCreate: 'Adicione os dados mínimos da empresa',
    progressReady: 'Workspace pronto para os próximos passos',
    unverifiedBody: (email: string) =>
      `Enviámos um link de verificação para ${email}. Abra-o no mesmo navegador para concluir o início de sessão.`,
    verifyTitle: 'Verifique o seu email',
    resend: 'Reenviar verificação',
    useDifferent: 'Usar email diferente',
    alreadyVerified: 'Já verificou? Atualize esta página após clicar no link.',
    resendDone: 'Email de verificação reenviado.',
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
    createCompanyResponseError: 'A configuração terminou sem devolver uma empresa válida. Tente novamente.',
    companyCreatedToast: 'Empresa criada com sucesso.',
    inviteAcceptedToast: (companyName: string) =>
      `Convite aceite. A entrar agora em ${companyName || 'sua empresa'}.`,
    choiceTitle: 'Escolha como quer começar',
    choiceBody:
      'Já tem pelo menos um convite pendente. Pode aceitá-lo agora, ou manter o convite para mais tarde e criar a sua própria empresa.',
    joinPathTitle: 'Entrar na empresa convidada',
    joinPathBody: 'Use o convite já endereçado à sua conta e entre no contexto certo da empresa.',
    joinPathHint: 'Recomendado quando a sua equipa já o convidou.',
    createPathTitle: 'Criar nova empresa',
    createPathBody: 'Inicie uma nova empresa apenas com os dados mínimos agora e conclua o perfil completo mais tarde.',
    createPathHint: 'Os seus convites pendentes continuam disponíveis se escolher este caminho.',
    invitationsTitle: 'Convites pendentes',
    invitationsBody:
      'Aqui aparecem apenas convites associados ao email da sua conta atual. Ao aceitar um deles, a respetiva associação fica ativa.',
    invitationStatusPending: 'Pendente',
    invitedRole: 'Função convidada',
    invitedBy: 'Convidado por',
    invitedOn: 'Convidado em',
    expiresOn: 'Expira em',
    fallbackInviter: 'Administrador da empresa',
    acceptInvite: 'Aceitar convite',
    createInstead: 'Criar empresa em vez disso',
    inviteSearchPlaceholder: 'Pesquisar convites',
    noInviteSearchResults: 'Nenhum convite corresponde a essa pesquisa.',
    noInvitesTitle: 'Crie a sua primeira empresa',
    noInvitesBody:
      'Não existem convites pendentes para esta conta, por isso pode começar diretamente com uma nova empresa.',
    createTitle: 'Criar empresa',
    createBody:
      'Neste momento, só o nome da empresa é obrigatório. Identidade fiscal, morada, contactos, dados bancários e branding podem ser concluídos mais tarde nas Definições.',
    companyNameLabel: 'Nome da empresa',
    companyPlaceholder: 'Nome da empresa',
    companyLabelHint: 'Use primeiro o nome comercial ou legal que os clientes reconhecem.',
    finishLaterLabel: 'Complete o perfil completo mais tarde',
    finishLaterTooltip:
      'As Definições cobrem identidade legal, morada, contactos, logótipo, dados bancários, dados fiscais e outras configurações avançadas da empresa.',
    createCompanyCta: 'Criar empresa',
    creatingCompany: 'A criar empresa...',
    readyTitle: 'O seu workspace está pronto',
    readyBody:
      'Continue agora para o dashboard, ou conclua o perfil da empresa e a configuração inicial antes de começar a registar atividade real.',
    readySummaryLabel: 'Empresa criada',
    continueDashboard: 'Continuar para o dashboard',
    completeProfile: 'Completar perfil da empresa',
    importOpeningData: 'Importar dados iniciais',
    addItems: 'Adicionar itens',
    inviteUsers: 'Convidar utilizadores',
    startupTitle: 'Não foi possível concluir a configuração',
    startupBody:
      'A autenticação foi concluída, mas os dados de onboarding estão temporariamente indisponíveis.',
    startupRetryHint: 'Atualize a página uma vez ou volte a entrar se a sessão tiver expirado.',
    inviteInvalidOrExpired:
      'Este convite já não é válido. Peça ao administrador da empresa para enviar um novo.',
    inviteWrongEmail:
      'Este convite pertence a outro endereço de email. Inicie sessão com a conta convidada para continuar.',
    inviteNotFound:
      'Não foi encontrado um convite pendente para esta empresa na sua conta.',
    inviteGenericError: 'Não foi possível aceitar o convite agora. Tente novamente.',
    returningInviteHint:
      'Pode voltar ao caminho do convite mais tarde. Criar uma empresa não apaga os seus convites pendentes.',
  },
} as const

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
  copy: (typeof copyByLang)['en'],
  error: { message?: string } | null | undefined,
) {
  const message = (error?.message || '').toLowerCase()
  if (message.includes('timed out')) return copy.startupBody
  if (message.includes('not_authenticated')) return copy.createCompanySessionExpired
  return copy.startupBody
}

function getFriendlyCreateCompanyError(
  copy: (typeof copyByLang)['en'],
  error: { message?: string; code?: string } | null | undefined,
) {
  const message = (error?.message || '').toLowerCase()
  if (message.includes('timed out')) return copy.createCompanyTimeout
  if (message.includes('not_authenticated')) return copy.createCompanySessionExpired
  if (message.includes('company_bootstrap_rate_limited')) return copy.createCompanyRateLimited
  if (message.includes('bootstrap_error') || error?.code === 'P0001') return copy.createCompanyFailed
  return copy.createCompanyFailed
}

function getFriendlyInviteError(
  copy: (typeof copyByLang)['en'],
  error: { message?: string } | null | undefined,
) {
  const code = getInviteErrorCode(error)
  if (code === 'invalid_or_expired') return copy.inviteInvalidOrExpired
  if (code === 'email_mismatch') return copy.inviteWrongEmail
  if (code === 'not_found') return copy.inviteNotFound
  if (code === 'not_authenticated') return copy.createCompanySessionExpired
  return copy.inviteGenericError
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

function formatLongDate(value: string | null, lang: 'en' | 'pt') {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat(lang === 'pt' ? 'pt-MZ' : 'en-MZ', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Maputo',
  }).format(parsed)
}

function roleLabel(role: MemberRole, lang: 'en' | 'pt') {
  const map = {
    OWNER: { en: 'Owner', pt: 'Owner' },
    ADMIN: { en: 'Admin', pt: 'Administrador' },
    MANAGER: { en: 'Manager', pt: 'Gestor' },
    OPERATOR: { en: 'Operator', pt: 'Operador' },
    VIEWER: { en: 'Viewer', pt: 'Leitor' },
  } as const
  return map[role]?.[lang] || role
}

function PathCard({
  title,
  body,
  hint,
  active,
  icon,
  onClick,
}: {
  title: string
  body: string
  hint: string
  active: boolean
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
          'group w-full rounded-3xl border bg-background/80 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5',
        active
          ? 'border-primary/50 bg-primary/5 shadow-sm ring-1 ring-primary/20'
          : 'border-border/70 hover:border-primary/20',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-base font-semibold text-foreground">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border/70 bg-card text-primary">
              {icon}
            </span>
            <span>{title}</span>
          </div>
            <p className="hidden text-sm leading-6 text-muted-foreground sm:block">{body}</p>
          </div>
        <ChevronRight
          className={cn(
            'mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200',
            active ? 'translate-x-0.5 text-primary' : 'group-hover:translate-x-0.5',
          )}
        />
      </div>
        <div className="mt-4 hidden text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground sm:block">
          {hint}
        </div>
    </button>
  )
}

export default function Onboarding() {
  const { lang, t } = useI18n()
  const copy = copyByLang[lang]
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [acceptingCompanyId, setAcceptingCompanyId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [path, setPath] = useState<'join' | 'create'>('create')
  const [invites, setInvites] = useState<PendingCompanyInvitation[]>([])
  const [inviteSearch, setInviteSearch] = useState('')
  const [completion, setCompletion] = useState<CompletionState | null>(null)

  const hasInvites = invites.length > 0
  const showInviteSearch = invites.length > 4
  const filteredInvites = useMemo(() => {
    const query = inviteSearch.trim().toLowerCase()
    if (!query) return invites
    return invites.filter((invite) => {
      const inviter = `${invite.inviter_name || ''} ${invite.inviter_email || ''}`.toLowerCase()
      const company = String(invite.company_name || '').toLowerCase()
      const role = roleLabel(invite.role, lang).toLowerCase()
      return company.includes(query) || inviter.includes(query) || role.includes(query)
    })
  }, [inviteSearch, invites, lang])

  const progressValue = completion
    ? 100
    : hasInvites
      ? path === 'join'
        ? 48
        : 66
      : companyName.trim()
        ? 68
        : 44

  const progressText = completion
    ? copy.progressReady
    : path === 'create'
      ? copy.progressCreate
      : copy.progressChoose

  async function loadPendingInvites() {
    const pendingInvites = await listMyPendingCompanyInvitations()
    setInvites(pendingInvites)
    if (pendingInvites.length === 0) {
      setPath('create')
      setInviteSearch('')
    }
    return pendingInvites
  }

  useEffect(() => {
    let cancelled = false

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
          if (!cancelled) {
            setUnverifiedEmail(user.email ?? 'your email')
            setLoading(false)
          }
          return
        }

        try {
          await withTimeout(
            runAdminUserSyncIfNeeded(user.id),
            BEST_EFFORT_SYNC_TIMEOUT_MS,
            'admin user sync',
          )
        } catch (error) {
          console.warn('admin user sync failed during onboarding:', error)
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

        if (!cancelled) {
          const pendingInvites = await loadPendingInvites()
          setPath(pendingInvites.length > 0 ? 'join' : 'create')
          setLoading(false)
        }
      } catch (error: any) {
        if (isDev) console.warn('[Onboarding] startup failed', error)
        if (!cancelled) {
          setStartupError(getFriendlyStartupError(copy, error))
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
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
      else toast.success(copy.resendDone)
    } finally {
      setResending(false)
    }
  }

  async function createCompany() {
    const name = companyName.trim()
    if (!name) {
      setSubmitError(copy.createCompanyError)
      toast.error(copy.createCompanyError)
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
        const friendly = getFriendlyCreateCompanyError(copy, error)
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
        setSubmitError(copy.createCompanyResponseError)
        toast.error(copy.createCompanyResponseError)
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

      const visibleCompanyId = (await waitForMembership(8000, 400)) || companyId
      rememberCompanyLocally(visibleCompanyId)
      setCompletion({
        companyId: visibleCompanyId,
        companyName: bootstrap?.company_name?.trim() || name,
      })
      toast.success(copy.companyCreatedToast)
    } catch (error: any) {
      if (isDev) console.warn('[Onboarding] create company request crashed', error)
      const friendly = getFriendlyCreateCompanyError(copy, error)
      setSubmitError(friendly)
      toast.error(friendly)
    } finally {
      setCreating(false)
    }
  }

  async function acceptInvitation(invite: PendingCompanyInvitation) {
    try {
      setAcceptingCompanyId(invite.company_id)
      setSubmitError(null)
      await acceptPendingCompanyInvitation(invite.company_id)
      rememberCompanyLocally(invite.company_id)
      toast.success(copy.inviteAcceptedToast(invite.company_name || ''))
      nav('/dashboard', { replace: true })
    } catch (error: any) {
      const friendly = getFriendlyInviteError(copy, error)
      setSubmitError(friendly)
      toast.error(friendly)
      const code = getInviteErrorCode(error)
      if (code === 'invalid_or_expired' || code === 'not_found') {
        await loadPendingInvites()
      }
    } finally {
      setAcceptingCompanyId(null)
    }
  }

  if (loading) {
    return (
      <PublicAuthShell
        subtitle={copy.subtitle}
        heroTitle={copy.heroTitle}
        heroBody={copy.heroBody}
        highlights={copy.highlights}
      >
        <Card className="border-border/70 bg-card/95 shadow-xl">
          <CardContent className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">
            {t('loading')}
          </CardContent>
        </Card>
      </PublicAuthShell>
    )
  }

  if (startupError) {
    return (
      <PublicAuthShell
        subtitle={copy.subtitle}
        heroTitle={copy.heroTitle}
        heroBody={copy.heroBody}
        highlights={copy.highlights}
      >
        <Card className="border-border/70 bg-card/95 shadow-xl">
          <CardHeader className="space-y-3">
            <CardTitle>{copy.startupTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{startupError}</p>
            <p className="text-sm text-muted-foreground">{copy.startupRetryHint}</p>
            <div className="flex gap-2">
              <Button onClick={() => window.location.reload()}>{copy.retry}</Button>
              <Button variant="secondary" onClick={() => location.assign('/login')}>
                {copy.backToSignIn}
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
        subtitle={copy.subtitle}
        heroTitle={copy.heroTitle}
        heroBody={copy.heroBody}
        highlights={copy.highlights}
      >
        <Card className="border-border/70 bg-card/95 shadow-xl">
          <CardHeader className="space-y-3">
            <CardTitle>{copy.verifyTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{copy.unverifiedBody(unverifiedEmail)}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={resendVerification} disabled={resending}>
                <Mail className="mr-2 h-4 w-4" />
                {resending ? t('actions.saving') : copy.resend}
              </Button>
              <Button variant="secondary" onClick={() => location.assign('/login')}>
                {copy.useDifferent}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{copy.alreadyVerified}</p>
          </CardContent>
        </Card>
      </PublicAuthShell>
    )
  }

  return (
    <PublicAuthShell
      subtitle={copy.subtitle}
      heroTitle={copy.heroTitle}
      heroBody={copy.heroBody}
      highlights={copy.highlights}
    >
      <TooltipProvider delayDuration={350}>
        <Card className="border-border/70 bg-card/95 shadow-xl">
          <CardHeader className="space-y-4 pb-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>{completion ? copy.readyTitle : hasInvites ? copy.choiceTitle : copy.noInvitesTitle}</CardTitle>
                  <p className="mt-2 hidden text-sm leading-6 text-muted-foreground sm:block">
                    {completion ? copy.readyBody : hasInvites ? copy.choiceBody : copy.noInvitesBody}
                  </p>
                </div>
                <Badge variant="secondary" className="hidden rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em] sm:inline-flex">
                  {progressText}
                </Badge>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <span>{copy.progressLabel}</span>
                  <span>{progressValue}%</span>
                </div>
                <Progress value={progressValue} className="h-2" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {submitError ? (
              <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            ) : null}

            {completion ? (
              <div className="space-y-6">
                <div className="rounded-3xl border border-primary/15 bg-primary/5 p-5">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-2xl border border-primary/20 bg-background p-2 text-primary">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">{copy.readySummaryLabel}</div>
                      <div className="text-xl font-semibold tracking-tight text-foreground">{completion.companyName}</div>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {copy.finishLaterTooltip}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Button onClick={() => nav('/dashboard', { replace: true })} className="justify-between">
                    <span>{copy.continueDashboard}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Button variant="secondary" onClick={() => nav('/settings', { replace: true })} className="justify-between">
                    <span>{copy.completeProfile}</span>
                    <Settings2 className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" onClick={() => nav('/setup/import', { replace: true })} className="justify-between">
                    <span>{copy.importOpeningData}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" onClick={() => nav('/items', { replace: true })} className="justify-between">
                    <span>{copy.addItems}</span>
                    <Building2 className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" onClick={() => nav('/users', { replace: true })} className="justify-between sm:col-span-2">
                    <span>{copy.inviteUsers}</span>
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {hasInvites ? (
                  <div className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <PathCard
                        title={copy.joinPathTitle}
                        body={copy.joinPathBody}
                        hint={copy.joinPathHint}
                        active={path === 'join'}
                        icon={<Users className="h-5 w-5" />}
                        onClick={() => setPath('join')}
                      />
                      <PathCard
                        title={copy.createPathTitle}
                        body={copy.createPathBody}
                        hint={copy.createPathHint}
                        active={path === 'create'}
                        icon={<Building2 className="h-5 w-5" />}
                        onClick={() => setPath('create')}
                      />
                    </div>

                    {path === 'join' ? (
                      <div className="rounded-3xl border border-border/70 bg-background/70 p-4 sm:p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                          <div>
                            <div className="text-base font-semibold text-foreground">{copy.invitationsTitle}</div>
                              <p className="mt-1 hidden text-sm leading-6 text-muted-foreground sm:block">{copy.invitationsBody}</p>
                          </div>
                          {showInviteSearch ? (
                            <div className="relative w-full sm:max-w-xs">
                              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                              <Input
                                value={inviteSearch}
                                onChange={(event) => setInviteSearch(event.target.value)}
                                placeholder={copy.inviteSearchPlaceholder}
                                className="pl-9"
                              />
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-4">
                          <ScrollArea className={cn(filteredInvites.length > 3 ? 'h-[360px] pr-4' : 'pr-4')}>
                            <div className="space-y-3">
                              {filteredInvites.length ? (
                                filteredInvites.map((invite) => {
                                  const accepting = acceptingCompanyId === invite.company_id
                                  const invitedOn = formatLongDate(invite.invited_at, lang)
                                  const expiresOn = formatLongDate(invite.expires_at, lang)
                                  const inviterLine = invite.inviter_name || invite.inviter_email || copy.fallbackInviter

                                  return (
                                    <div
                                      key={`${invite.company_id}:${invite.source}`}
                        className="rounded-3xl border border-border/70 bg-card/80 p-3 transition-all duration-200 hover:border-primary/20 hover:shadow-sm sm:p-4"
                                    >
                                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="space-y-3">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <div className="text-base font-semibold text-foreground">
                                              {invite.company_name || 'StockWise company'}
                                            </div>
                                            <Badge variant="outline">{copy.invitationStatusPending}</Badge>
                                            <Badge variant="secondary">{roleLabel(invite.role, lang)}</Badge>
                                          </div>
                                          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                                            <div>
                                              <div className="font-medium text-foreground">{copy.invitedRole}</div>
                                              <div>{roleLabel(invite.role, lang)}</div>
                                            </div>
                                            <div>
                                              <div className="font-medium text-foreground">{copy.invitedBy}</div>
                                              <div>{inviterLine}</div>
                                            </div>
                                            {invitedOn ? (
                                              <div>
                                                <div className="font-medium text-foreground">{copy.invitedOn}</div>
                                                <div>{invitedOn}</div>
                                              </div>
                                            ) : null}
                                            {expiresOn ? (
                                              <div>
                                                <div className="font-medium text-foreground">{copy.expiresOn}</div>
                                                <div>{expiresOn}</div>
                                              </div>
                                            ) : null}
                                          </div>
                                        </div>
                                        <div className="flex shrink-0 flex-col gap-2 sm:w-[220px]">
                                          <Button
                                            onClick={() => void acceptInvitation(invite)}
                                            disabled={acceptingCompanyId !== null}
                                            className="justify-between"
                                          >
                                            <span>{accepting ? copy.acceptInvite : copy.acceptInvite}</span>
                                            {accepting ? (
                                              <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                              <ArrowRight className="h-4 w-4" />
                                            )}
                                          </Button>
                                          <Button variant="ghost" onClick={() => setPath('create')}>
                                            {copy.createInstead}
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })
                              ) : (
                                <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                                  {copy.noInviteSearchResults}
                                </div>
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-border/70 bg-background/70 p-4 text-sm leading-6 text-muted-foreground">
                        {copy.returningInviteHint}
                      </div>
                    )}
                  </div>
                ) : null}

                {path === 'create' ? (
                  <div className="rounded-3xl border border-border/70 bg-background/70 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="text-base font-semibold text-foreground">{copy.createTitle}</div>
                            <p className="mt-1 hidden text-sm leading-6 text-muted-foreground sm:block">{copy.createBody}</p>
                          </div>
                          <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-muted/20 px-3 py-1.5 text-xs font-medium text-muted-foreground sm:inline-flex">
                        <span>{copy.finishLaterLabel}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground">
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs leading-5">
                            {copy.finishLaterTooltip}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div className="space-y-2">
                        <Label htmlFor="companyName">{copy.companyNameLabel}</Label>
                        <Input
                          id="companyName"
                          placeholder={copy.companyPlaceholder}
                          value={companyName}
                          autoFocus={!hasInvites}
                          disabled={creating}
                          onChange={(event) => {
                            setCompanyName(event.target.value)
                            if (submitError) setSubmitError(null)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void createCompany()
                          }}
                        />
                          <p className="hidden text-xs text-muted-foreground sm:block">{copy.companyLabelHint}</p>
                      </div>
                      <Button
                        onClick={() => void createCompany()}
                        disabled={creating || !companyName.trim()}
                        className="sm:min-w-[180px] sm:self-stretch"
                      >
                        <span>{creating ? copy.creatingCompany : copy.createCompanyCta}</span>
                        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </TooltipProvider>
    </PublicAuthShell>
  )
}
