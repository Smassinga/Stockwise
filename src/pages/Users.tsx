import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Search, UserCog } from 'lucide-react'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { CrownIcon } from '@phosphor-icons/react/dist/csr/Crown'
import { ShieldCheckIcon as PhosphorShieldCheckIcon } from '@phosphor-icons/react/dist/csr/ShieldCheck'
import { UserPlusIcon } from '@phosphor-icons/react/dist/csr/UserPlus'
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree'
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning'
import { XCircleIcon } from '@phosphor-icons/react/dist/csr/XCircle'
import toast from 'react-hot-toast'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { authFetch } from '../lib/authFetch'
import { supabase } from '../lib/supabase'
import { useOrg } from '../hooks/useOrg'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { PremiumPageHeader } from '../components/premium/PremiumPageHeader'
import { IconBadge } from '../components/premium/IconBadge'
import { PremiumStatusBadge } from '../components/premium/PremiumStatusBadge'
import { PremiumSkeleton } from '../components/premium/PremiumSkeleton'
import { OperationalSummaryBand } from '../components/premium/OperationalSummaryBand'
import { hasMinRole, canAssignRole, canInviteRole } from '../lib/roles'

type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER'
type Status = 'invited' | 'active' | 'disabled'

type Member = {
  email: string | null
  user_id: string | null
  role: Role
  status: Status
  invited_by?: string | null
  created_at?: string | null
  last_sign_in_at?: string | null
  email_confirmed_at?: string | null
}

type InviteResult = {
  state: 'sent' | 'email_failed' | 'link_copied' | 'created'
  email: string
  role: Role
  link: string
}

const roleRank = (role: Role) => ({ OWNER: 0, ADMIN: 1, MANAGER: 2, OPERATOR: 3, VIEWER: 4 }[role] ?? 99)
const allRoles: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER']

const roleDefinitionCopy = {
  en: {
    navMembers: 'Members',
    navRoles: 'Role definitions',
    definitionsTitle: 'Role definitions',
    definitionsBody:
      'These descriptions mirror the current company role checks used by StockWise. They explain the practical effect before you invite or reassign a teammate.',
    canonicalTitle: 'Canonical role model',
    canonicalBody:
      'Company access is controlled by company_members and member_role. Invitation status must become active before protected company routes are unlocked.',
    platformTitle: 'Platform admin is separate',
    platformBody:
      'Platform-admin access is for StockWise control-plane operations only. Company owners do not receive platform-admin controls through company roles.',
    canDo: 'Can do',
    cannotDo: 'Cannot do',
    bestFor: 'Best for',
    powerfulRole: 'Powerful role',
    definitions: {
      OWNER: {
        summary: 'Full company authority and highest role assignment power.',
        bestFor: 'Business owners or the accountable tenant administrator.',
        can: [
          'Manage users and assign any company role',
          'Approve, issue, post, void, and adjust finance documents',
          'Create, update, and delete operational records where the app allows it',
        ],
        cannot: [
          'Bypass fiscal/posting rules or audit restrictions',
          'Access platform-admin controls unless separately granted',
        ],
      },
      ADMIN: {
        summary: 'Finance authority with broad operational administration.',
        bestFor: 'Finance leads or senior administrators who issue legal documents.',
        can: [
          'Approve and issue sales invoices and adjustments',
          'Post vendor bills and finance adjustments',
          'Manage users up to admin level, except owner escalation',
        ],
        cannot: [
          'Assign or remove owner authority',
          'Bypass protected fiscal and settlement workflows',
        ],
      },
      MANAGER: {
        summary: 'Operational supervisor with user-management and delete authority.',
        bestFor: 'Warehouse, operations, or branch managers.',
        can: [
          'Invite and manage viewer, operator, and manager roles',
          'Create/update operational records and delete allowed master data',
          'Manage warehouses and review operational/finance information',
        ],
        cannot: [
          'Approve, issue, post, or void legal finance documents',
          'Assign owner/admin roles or modify higher roles',
        ],
      },
      OPERATOR: {
        summary: 'Day-to-day worker for stock, orders, and draft preparation.',
        bestFor: 'Staff creating items, movements, orders, and finance drafts.',
        can: [
          'Create and update items, movements, and master data',
          'Create/edit finance drafts and submit them for approval',
          'Use operational workspaces needed for daily activity',
        ],
        cannot: [
          'Delete controlled records or manage users',
          'Approve, issue, post, or void finance documents',
        ],
      },
      VIEWER: {
        summary: 'Read-oriented access for review and reporting.',
        bestFor: 'Auditors, advisors, or team members who only need visibility.',
        can: [
          'View company information available to the member',
          'Export reports where report export is enabled for viewers',
        ],
        cannot: [
          'Create, update, delete, approve, issue, post, or void records',
          'Invite users or change roles',
        ],
      },
    },
  },
  pt: {
    navMembers: 'Membros',
    navRoles: 'Definições de funções',
    definitionsTitle: 'Definições de funções',
    definitionsBody:
      'Estas descrições refletem as verificações actuais de funções da empresa no StockWise. Servem para explicar o impacto prático antes de convidar ou alterar um colega.',
    canonicalTitle: 'Modelo canónico de funções',
    canonicalBody:
      'O acesso à empresa é controlado por company_members e member_role. O convite tem de ficar activo antes de desbloquear rotas protegidas da empresa.',
    platformTitle: 'Administrador da plataforma é separado',
    platformBody:
      'O acesso de administrador da plataforma serve apenas operações de controlo do StockWise. Proprietários de empresa não recebem esses controlos através das funções da empresa.',
    canDo: 'Pode fazer',
    cannotDo: 'Não pode fazer',
    bestFor: 'Indicado para',
    powerfulRole: 'Função sensível',
    definitions: {
      OWNER: {
        summary: 'Autoridade total da empresa e maior poder de atribuição de funções.',
        bestFor: 'Proprietários ou o administrador responsável pelo tenant.',
        can: [
          'Gerir utilizadores e atribuir qualquer função da empresa',
          'Aprovar, emitir, lançar, anular e ajustar documentos financeiros',
          'Criar, actualizar e remover registos operacionais onde a app permite',
        ],
        cannot: [
          'Contornar regras fiscais, de lançamento ou de auditoria',
          'Aceder a controlos de plataforma sem uma concessão separada',
        ],
      },
      ADMIN: {
        summary: 'Autoridade financeira com administração operacional ampla.',
        bestFor: 'Responsáveis financeiros ou administradores sénior que emitem documentos legais.',
        can: [
          'Aprovar e emitir facturas de venda e ajustes',
          'Lançar facturas de fornecedor e ajustes financeiros',
          'Gerir utilizadores até ao nível de administrador, sem elevar a proprietário',
        ],
        cannot: [
          'Atribuir ou remover autoridade de proprietário',
          'Contornar workflows fiscais e de liquidação protegidos',
        ],
      },
      MANAGER: {
        summary: 'Supervisor operacional com gestão de utilizadores e autoridade de remoção.',
        bestFor: 'Gestores de armazém, operações ou filial.',
        can: [
          'Convidar e gerir leitores, operadores e gestores',
          'Criar/actualizar registos operacionais e remover dados mestre permitidos',
          'Gerir armazéns e rever informação operacional/financeira',
        ],
        cannot: [
          'Aprovar, emitir, lançar ou anular documentos financeiros legais',
          'Atribuir funções de proprietário/admin ou alterar funções superiores',
        ],
      },
      OPERATOR: {
        summary: 'Utilizador diário para stock, pedidos e preparação de rascunhos.',
        bestFor: 'Equipa que cria artigos, movimentos, pedidos e rascunhos financeiros.',
        can: [
          'Criar e actualizar artigos, movimentos e dados mestre',
          'Criar/editar rascunhos financeiros e submetê-los para aprovação',
          'Usar áreas operacionais necessárias para o trabalho diário',
        ],
        cannot: [
          'Remover registos controlados ou gerir utilizadores',
          'Aprovar, emitir, lançar ou anular documentos financeiros',
        ],
      },
      VIEWER: {
        summary: 'Acesso orientado a consulta para revisão e relatórios.',
        bestFor: 'Auditores, consultores ou colegas que só precisam de visibilidade.',
        can: [
          'Ver informação da empresa disponível ao membro',
          'Exportar relatórios quando a exportação está activa para leitores',
        ],
        cannot: [
          'Criar, actualizar, remover, aprovar, emitir, lançar ou anular registos',
          'Convidar utilizadores ou alterar funções',
        ],
      },
    },
  },
} as const

function extractFnErr(error: any): string {
  const ctx = error?.context
  if (!ctx) return error?.message || 'Unknown error'
  if (ctx.body) {
    try {
      const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body
      return parsed?.error || parsed?.message || (typeof ctx.body === 'string' ? ctx.body : error?.message)
    } catch {
      return typeof ctx.body === 'string' ? ctx.body : error?.message || 'Unknown error'
    }
  }
  return error?.message || 'Unknown error'
}

export default function Users() {
  const { companyId, companyName, myRole, authorityMode } = useOrg()
  const { t, lang } = useI18n()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const roleCopy = roleDefinitionCopy[lang]
  const isRolesView = location.pathname.endsWith('/roles')

  const canAccessUsersPage = hasMinRole(myRole, 'MANAGER')
  const canManageUsers = canAccessUsersPage
  const canInviteAdmins = hasMinRole(myRole, 'ADMIN')

  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('VIEWER')
  const [sendingInvite, setSendingInvite] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all')
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all')
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null)
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [selectedRole, setSelectedRole] = useState<Role>('VIEWER')
  const [selectedStatus, setSelectedStatus] = useState<Status>('active')
  const inviteButtonRef = useRef<HTMLButtonElement>(null)
  const memberReviewTriggerRef = useRef<HTMLButtonElement | null>(null)

  const [myEmail, setMyEmail] = useState<string | null>(null)
  const [myName, setMyName] = useState<string | null>(null)

  const roleLabel = (role: Role) => tt(`users.roles.${role.toLowerCase()}`, role)
  const statusLabel = (status: Status) => tt(`users.statuses.${status}`, tt('administration.statusUnavailable', 'Status unavailable'))
  const statusTone = (status: Status) => status === 'active' ? 'success' : status === 'invited' ? 'info' : 'neutral'

  const higherThanMe = (role: Role) => (myRole ? roleRank(role) < roleRank(myRole) : false)

  useEffect(() => {
    ;(async () => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        const user = sessionData.session?.user
        setMyEmail(user?.email ?? null)
        setMyName((user?.user_metadata?.name as string) || (user?.email ? user.email.split('@')[0] : '') || null)
        if (sessionData.session?.access_token) {
          try {
            await supabase.rpc('sync_invites_for_me')
          } catch {
            // best-effort only
          }
        }
      } catch {
        // non-fatal bootstrap
      }
    })()
  }, [])

  useEffect(() => {
    if (!companyId) {
      setMembers([])
      setLoading(false)
      return
    }
    void refreshMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  useEffect(() => {
    if (searchParams.get('action') !== 'invite') setInviteResult(null)
  }, [searchParams])

  function openMember(member: Member, trigger: HTMLButtonElement) {
    memberReviewTriggerRef.current = trigger
    setSelectedMember(member)
    setSelectedRole(member.role)
    setSelectedStatus(member.status)
  }

  async function refreshMembers() {
    if (!companyId) return
    try {
      setLoading(true)
      setMemberError(null)
      const data = await authFetch<{ users?: Member[] }>(`admin-users/?company_id=${encodeURIComponent(companyId)}`, {
        method: 'GET',
      })
      setMembers((data?.users || []) as Member[])
    } catch (e: any) {
      console.error(e)
      const message = extractFnErr(e)
      const friendly = message || tt('users.toast.loadFailed', 'Failed to load members')
      setMemberError(friendly)
      toast.error(friendly)
    } finally {
      setLoading(false)
    }
  }

  async function callMailerInvite(options: {
    company_id: string
    company_name?: string
    invite_link: string
    email: string
    role: Role
    inviter_name?: string | null
    inviter_email?: string | null
    mode: 'email' | 'link'
  }): Promise<{ ok: boolean; link?: string }> {
    try {
      const { data, error } = await supabase.functions.invoke('mailer-invite', {
        body: options,
      })
      if (error) {
        const message = extractFnErr(error)
        console.error('mailer-invite 4xx/5xx:', { message, raw: error })
        return { ok: false }
      }
      if (data?.warning) toast(tt('users.toast.inviteWarning', 'Invite created with warning: {warning}', { warning: data.warning }))
      return { ok: true, link: data?.link }
    } catch (e: any) {
      console.error('mailer-invite threw:', e)
      return { ok: false }
    }
  }

  async function invite() {
    if (!companyId) return
    if (!canManageUsers) return toast.error(t('users.noPermissionToInvite'))
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return toast.error(t('users.emailRequired'))
    if (!canInviteRole(myRole as import('../lib/roles').CompanyRole, inviteRole)) {
      return toast.error(t('users.cannotInviteRole'))
    }

    try {
      setSendingInvite(true)
      const { data: token, error } = await supabase.rpc(
        authorityMode === 'platform_workspace'
          ? 'platform_admin_invite_assisted_member'
          : 'invite_company_member',
        authorityMode === 'platform_workspace'
          ? { p_company_id: companyId, p_email: email, p_role: inviteRole }
          : { p_company: companyId, p_email: email, p_role: inviteRole },
      )
      if (error) throw error

      const link = `${window.location.origin}/accept-invite?token=${token}`
      const result = await callMailerInvite({
        company_id: companyId,
        company_name: companyName || 'StockWise',
        invite_link: link,
        email,
        role: inviteRole,
        inviter_name: myName,
        inviter_email: myEmail,
        mode: 'email',
      })

      if (!result.ok) {
        try {
          await navigator.clipboard.writeText(link)
          toast.error(t('users.emailSendFailed'))
          setInviteResult({ state: 'email_failed', email, role: inviteRole, link })
        } catch {
          toast.error(t('users.couldNotCopyLink'))
          setInviteResult({ state: 'created', email, role: inviteRole, link })
        }
      } else {
        toast.success(t('users.inviteSent', { email }))
        setInviteResult({ state: 'sent', email, role: inviteRole, link })
      }

      setInviteEmail('')
      setInviteRole('VIEWER')
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('users.toast.inviteCreateFailed', 'Failed to invite'))
    } finally {
      setSendingInvite(false)
    }
  }

  async function copyInviteLink() {
    if (!inviteResult) return
    try {
      await navigator.clipboard.writeText(inviteResult.link)
      toast.success(tt('users.toast.linkCopied', 'Invite link copied'))
      setInviteResult({ ...inviteResult, state: 'link_copied' })
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('users.toast.copyLinkFailed', 'Could not copy the invite link'))
    }
  }

  async function reinvite(email: string, role: Role) {
    if (!email) return toast.error(tt('users.noEmailRecord', 'No email on record for this member.'))
    if (!companyId) return
    if (!canManageUsers) return toast.error(tt('users.toast.noPermissionReinvite', 'You do not have permission to reinvite.'))
    try {
      const { data: token, error } = await supabase.rpc(
        authorityMode === 'platform_workspace'
          ? 'platform_admin_invite_assisted_member'
          : 'reinvite_company_member',
        authorityMode === 'platform_workspace'
          ? { p_company_id: companyId, p_email: email, p_role: role }
          : { p_company: companyId, p_email: email },
      )
      if (error) throw error

      const link = `${window.location.origin}/accept-invite?token=${token}`
      const result = await callMailerInvite({
        company_id: companyId,
        company_name: companyName || 'StockWise',
        invite_link: link,
        email,
        role,
        inviter_name: myName,
        inviter_email: myEmail,
        mode: 'email',
      })

      if (!result.ok) {
        try {
          await navigator.clipboard.writeText(link)
          toast.error(tt('users.emailSendFailed', 'Email send failed; invite link copied to clipboard.'))
        } catch {
          toast.error(tt('users.couldNotCopyLink', 'Email send failed; could not copy link.'))
        }
      } else {
        toast.success(tt('users.toast.reinviteSent', 'Invite re-sent to {email}.', { email }))
      }
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('users.toast.reinviteFailed', 'Failed to reinvite'))
    }
  }

  async function updateMember(email: string, next: Partial<Pick<Member, 'role' | 'status'>>, currentRowRole: Role) {
    if (!email) return toast.error(t('users.noEmailRecord'))
    if (!companyId) return
    if (!canManageUsers) return toast.error(t('users.noPermissionToUpdate'))
    if (higherThanMe(currentRowRole)) {
      return toast.error(t('users.cannotModifyHigherRole'))
    }
    if (next.role && !canAssignRole(myRole as import('../lib/roles').CompanyRole, next.role)) {
      return toast.error(t('users.cannotAssignRole'))
    }
    if (!canInviteAdmins && (next.role === 'OWNER' || next.role === 'ADMIN')) {
      return toast.error(t('users.cannotAssignOwnerAdmin'))
    }

    try {
      await authFetch('admin-users/member', {
        method: 'PATCH',
        body: {
          company_id: companyId,
          email,
          ...next,
        },
      })
      toast.success(t('users.memberUpdated'))
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      const message = extractFnErr(e)
      toast.error(message || t('users.failedToUpdateMember'))
    }
  }

  async function removeMember(email: string, targetRole: Role) {
    if (!email) return toast.error(tt('users.noEmailRecord', 'No email on record for this member.'))
    if (!companyId) return
    if (!canManageUsers) return toast.error('You do not have permission to remove members.')
    if (myEmail && email.toLowerCase() === myEmail.toLowerCase()) {
      return toast.error(tt('users.cannotRemoveSelf', 'You cannot remove yourself'))
    }
    if (higherThanMe(targetRole)) {
      return toast.error('You cannot remove a member with a higher role than yours.')
    }

    try {
      await authFetch('admin-users/member', {
        method: 'DELETE',
        body: {
          company_id: companyId,
          email,
        },
      })
      toast.success(tt('users.toast.memberRemoved', 'Member removed'))
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      const message = extractFnErr(e)
      toast.error(message || tt('users.toast.memberRemoveFailed', 'Failed to remove member'))
    }
  }

  const roleOptions: Role[] = allRoles.filter((role) =>
    canInviteRole(myRole as import('../lib/roles').CompanyRole, role)
  )

  const sortedMembers = useMemo(
    () =>
      [...members].sort((left, right) => {
        const roleSort = roleRank(left.role) - roleRank(right.role)
        if (roleSort !== 0) return roleSort
        if (left.status !== right.status) return left.status.localeCompare(right.status)
        return (left.email || '').localeCompare(right.email || '')
      }),
    [members]
  )

  const filteredMembers = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase()
    return sortedMembers.filter((member) => {
      const matchesStatus = statusFilter === 'all' ? true : member.status === statusFilter
      const matchesRole = roleFilter === 'all' ? true : member.role === roleFilter
      const matchesSearch = needle
        ? [member.email || '', member.role, member.status].join(' ').toLowerCase().includes(needle)
        : true
      return matchesStatus && matchesRole && matchesSearch
    })
  }, [roleFilter, searchTerm, sortedMembers, statusFilter])

  const memberStats = useMemo(() => {
    const active = members.filter((member) => member.status === 'active').length
    const invited = members.filter((member) => member.status === 'invited').length
    const disabled = members.filter((member) => member.status === 'disabled').length
    const sensitive = members.filter((member) => member.status === 'active' && ['OWNER', 'ADMIN'].includes(member.role)).length
    return { total: members.length, active, invited, disabled, sensitive }
  }, [members])

  if (!canAccessUsersPage) {
    return <div className="text-sm text-muted-foreground">{t('users.noPermission')}</div>
  }

  return (
    <div className="space-y-6 overflow-x-hidden">
      <PremiumPageHeader
        title={t('sections.users.title')}
        context={
          <PremiumStatusBadge tone="info" icon={<PhosphorShieldCheckIcon className="h-3.5 w-3.5" weight="duotone" />}>
            {myRole ? `${t('users.yourRole')}: ${roleLabel(myRole as Role)}` : roleCopy.canonicalTitle}
          </PremiumStatusBadge>
        }
        meta={
          companyId ? (
            <>
              <span>{t('users.company')}: {companyName || tt('setup.companyFallback', 'Active company')}</span>
              <span aria-hidden="true">/</span>
              <span>{isRolesView ? roleCopy.navRoles : roleCopy.navMembers}</span>
            </>
          ) : null
        }
        actions={
          <div className="mobile-primary-actions">
            <Button asChild size="sm" variant="outline">
              <Link to="/settings?view=setup">
                <ArrowLeft className="h-4 w-4" />
                {tt('setup.users.return', 'Company setup')}
              </Link>
            </Button>
            <Button asChild size="sm" variant={isRolesView ? 'outline' : 'default'}>
              <Link to="/users">
                <UsersThreeIcon className="h-4 w-4" weight="duotone" />
                {roleCopy.navMembers}
              </Link>
            </Button>
            <Button asChild size="sm" variant={isRolesView ? 'default' : 'outline'}>
              <Link to="/users/roles">
                <PhosphorShieldCheckIcon className="h-4 w-4" weight="duotone" />
                {roleCopy.navRoles}
              </Link>
            </Button>
            {!isRolesView ? (
              <Button ref={inviteButtonRef} size="sm" onClick={() => setSearchParams({ action: 'invite' })}>
                <UserPlusIcon className="h-4 w-4" weight="duotone" />
                {tt('users.inviteMember', 'Invite member')}
              </Button>
            ) : null}
          </div>
        }
      />

      {!isRolesView ? (
        <>
          {loading ? (
            <PremiumSkeleton variant="summary" rows={2} label={tt('users.loadingMembers', 'Loading members')} />
          ) : (
            <OperationalSummaryBand
              label={tt('users.summary.label', 'Company access summary')}
              items={[
                { label: tt('users.summary.active', 'Active'), value: memberStats.active, tone: 'success' },
                { label: tt('users.summary.invited', 'Invited'), value: memberStats.invited, tone: memberStats.invited ? 'info' : 'neutral' },
                { label: tt('users.summary.disabled', 'Disabled'), value: memberStats.disabled, tone: memberStats.disabled ? 'warning' : 'neutral' },
                { label: tt('users.summary.sensitive', 'Sensitive roles'), value: memberStats.sensitive, tone: memberStats.sensitive ? 'info' : 'neutral' },
              ]}
            />
          )}

          <div className="rounded-[var(--radius)] border border-border/70 bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
            {memberStats.invited > 0
              ? tt('setup.users.pendingGuidance', '{count} invitation(s) are awaiting acceptance. Pending access is not active membership.', { count: memberStats.invited })
              : memberStats.active <= 1
                ? tt('setup.users.singleOwnerGuidance', 'A single-user company is valid. Invite teammates only when the operation requires shared access.')
                : tt('setup.users.activeGuidance', 'Active members can use the company according to their assigned role. Review role definitions before changing access.')}
          </div>
        </>
      ) : null}

      {isRolesView ? (
        <div className="space-y-4">
          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PhosphorShieldCheckIcon className="h-5 w-5 text-primary" weight="duotone" />
                {roleCopy.definitionsTitle}
              </CardTitle>
              <CardDescription className="hidden sm:block">{roleCopy.definitionsBody}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 xl:grid-cols-5">
                {allRoles.map((role) => {
                  const definition = roleCopy.definitions[role]
                  const powerful = role === 'OWNER' || role === 'ADMIN'
                  return (
                    <Card key={role} className="border-border/70 shadow-none">
                      <CardHeader className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <CardTitle className="text-lg">{roleLabel(role)}</CardTitle>
                            <CardDescription className="mt-2 leading-6">{definition.summary}</CardDescription>
                          </div>
                          {role === 'OWNER' ? (
                            <IconBadge tone="warning" size="compact">
                              <CrownIcon weight="duotone" />
                            </IconBadge>
                          ) : powerful ? (
                            <IconBadge tone="warning" size="compact">
                              <WarningIcon weight="duotone" />
                            </IconBadge>
                          ) : null}
                        </div>
                        {powerful ? (
                          <PremiumStatusBadge tone="warning">
                            {roleCopy.powerfulRole}
                          </PremiumStatusBadge>
                        ) : null}
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="rounded-2xl border border-border/70 bg-muted/15 p-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{roleCopy.bestFor}</div>
                          <div className="mt-2 text-sm leading-6 text-foreground">{definition.bestFor}</div>
                        </div>
                        <div>
                          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                            <CheckCircleIcon className="h-4 w-4 text-status-success-foreground" weight="duotone" />
                            {roleCopy.canDo}
                          </div>
                          <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
                            {definition.can.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                            <XCircleIcon className="h-4 w-4 text-destructive" weight="duotone" />
                            {roleCopy.cannotDo}
                          </div>
                          <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
                            {definition.cannot.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
                  <div className="text-sm font-semibold">{roleCopy.canonicalTitle}</div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{roleCopy.canonicalBody}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
                  <div className="text-sm font-semibold">{roleCopy.platformTitle}</div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{roleCopy.platformBody}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
      <Dialog
        open={searchParams.get('action') === 'invite'}
        onOpenChange={(open) => {
          if (!open && !sendingInvite) {
            setSearchParams({})
          }
        }}
      >
        <DialogContent
          className="max-w-2xl"
          closeLabel={t('common.close')}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            inviteButtonRef.current?.focus()
          }}
        >
          <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlusIcon className="h-5 w-5" weight="duotone" />
            {tt('users.inviteTitle', 'Invite teammate')}
          </DialogTitle>
          <DialogDescription>
            {tt('users.inviteHelp', 'Invite records stay visible until the teammate accepts. Creating the invitation and delivering its email are separate results.')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {!companyId ? (
            <p className="text-muted-foreground">{t('users.noCompany')}</p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>{t('users.email')}</Label>
                  <Input
                    placeholder={tt('users.placeholder.email', 'name@example.com')}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label>{t('users.role')}</Label>
                  <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as Role)} disabled={!canManageUsers}>
                    <SelectTrigger>
                      <SelectValue placeholder={tt('users.placeholder.role', 'Select role')} />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((role) => (
                        <SelectItem
                          key={role}
                          value={role}
                          disabled={!canInviteAdmins && (role === 'OWNER' || role === 'ADMIN')}
                        >
                          {roleLabel(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 p-4 text-sm">
                <div className="font-medium">{roleLabel(inviteRole)}</div>
                <div className="mt-1 text-muted-foreground">{roleCopy.definitions[inviteRole].summary}</div>
              </div>
              {inviteResult ? (
                <div role="status" tabIndex={-1} className="rounded-lg border border-primary/25 bg-primary/5 p-4">
                  <div className="font-medium">
                    {inviteResult.state === 'sent'
                      ? tt('users.inviteResult.sent', 'Invitation created and email sent')
                      : inviteResult.state === 'email_failed'
                        ? tt('users.inviteResult.emailFailed', 'Invitation created; email delivery failed')
                        : inviteResult.state === 'link_copied'
                          ? tt('users.inviteResult.linkCopied', 'Invitation link copied')
                          : tt('users.inviteResult.created', 'Invitation created; link available for copying')}
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {inviteResult.email} / {roleLabel(inviteResult.role)}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </DialogBody>
        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={copyInviteLink} disabled={!inviteResult || sendingInvite}>
            {t('users.copyInviteLink')}
          </Button>
          <Button onClick={invite} disabled={!canManageUsers || sendingInvite}>
            {sendingInvite ? t('loading') : t('users.inviteAndEmail')}
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>{t('users.members')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="mb-4 grid gap-3 md:grid-cols-[1fr_200px_200px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={tt('users.searchPlaceholder', 'Search members by email, role, or status')}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | Status)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tt('users.filters.allStatuses', 'All statuses')}</SelectItem>
                <SelectItem value="active">{tt('users.summary.active', 'Active')}</SelectItem>
                <SelectItem value="invited">{tt('users.summary.invited', 'Invited')}</SelectItem>
                <SelectItem value="disabled">{tt('users.summary.disabled', 'Disabled')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as 'all' | Role)}>
              <SelectTrigger aria-label={tt('users.filters.role', 'Filter by role')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tt('users.filters.allRoles', 'All roles')}</SelectItem>
                {allRoles.map((role) => <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {memberError ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="font-medium">{tt('users.registerUnavailable', 'Member register unavailable')}</div>
              <div className="mt-1 text-sm text-muted-foreground">{memberError}</div>
              <Button className="mt-3" variant="outline" onClick={() => void refreshMembers()}>
                {tt('actions.retry', 'Retry')}
              </Button>
            </div>
          ) : loading ? (
            <p className="text-muted-foreground">{t('loading')}</p>
          ) : filteredMembers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
              <div className="text-lg font-medium">
                {searchTerm || statusFilter !== 'all' || roleFilter !== 'all'
                  ? tt('users.empty.filteredTitle', 'No members match the current filters.')
                  : tt('users.empty.title', 'No members yet.')}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {searchTerm || statusFilter !== 'all' || roleFilter !== 'all'
                  ? tt('users.empty.filteredBody', 'Clear the filters or search for a different email.')
                  : tt('users.empty.body', 'Invite the first teammate to start managing company access from here.')}
              </div>
            </div>
          ) : (
            <>
            <div className="space-y-3 md:hidden">
              {filteredMembers.map((member) => {
                const isSelf = !!myEmail && !!member.email && member.email.toLowerCase() === myEmail.toLowerCase()
                return (
                  <div key={`mobile-${member.user_id || member.email || `${member.role}-${member.status}-${member.created_at}`}`} className="rounded-2xl border border-border/70 bg-background/92 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{member.email || t('common.dash')}</div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <Badge variant="outline">{roleLabel(member.role)}</Badge>
                          <PremiumStatusBadge tone={statusTone(member.status)}>
                            {statusLabel(member.status)}
                          </PremiumStatusBadge>
                        </div>
                      </div>
                      {isSelf ? <Badge variant="secondary">{tt('users.thisIsYou', 'This is you')}</Badge> : null}
                    </div>
                    <div className="mt-4 grid gap-2 text-sm text-muted-foreground">
                      <div>{member.user_id ? tt('users.linkedAccount', 'Linked account') : tt('users.inviteOnly', 'Invite only')}</div>
                      <div>{t('users.table.confirmed')}: {member.email_confirmed_at ? new Date(member.email_confirmed_at).toLocaleString() : t('common.dash')}</div>
                      <div>{t('users.table.lastSignin')}: {member.last_sign_in_at ? new Date(member.last_sign_in_at).toLocaleString() : t('common.dash')}</div>
                    </div>
                    <Button className="mt-4 w-full" variant="outline" onClick={(event) => openMember(member, event.currentTarget)}>
                      <UserCog className="h-4 w-4" />
                      {tt('users.reviewMember', 'Review member')}
                    </Button>
                  </div>
                )
              })}
            </div>

            <table className="hidden w-full min-w-[1040px] text-sm md:table">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-2">Email</th>
                  <th className="py-2 pr-2">{t('users.role')}</th>
                  <th className="py-2 pr-2">{tt('users.status', 'Status')}</th>
                  <th className="py-2 pr-2">{t('users.table.confirmed')}</th>
                  <th className="py-2 pr-2">{t('users.table.lastSignin')}</th>
                  <th className="py-2 pr-2 text-right">{t('users.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => {
                  const isSelf = !!myEmail && !!member.email && member.email.toLowerCase() === myEmail.toLowerCase()

                  return (
                    <tr key={member.user_id || member.email || `${member.role}-${member.status}-${member.created_at}`} className="border-b">
                      <td className="py-3 pr-2">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{member.email || t('common.dash')}</span>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            {member.user_id ? <span>{tt('users.linkedAccount', 'Linked account')}</span> : <span>{tt('users.inviteOnly', 'Invite only')}</span>}
                            {isSelf ? <span>{tt('users.thisIsYou', 'This is you')}</span> : null}
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <Badge variant="outline">{roleLabel(member.role)}</Badge>
                      </td>
                      <td className="py-2 pr-2">
                        <PremiumStatusBadge tone={statusTone(member.status)}>
                          {statusLabel(member.status)}
                        </PremiumStatusBadge>
                      </td>
                      <td className="py-2 pr-2">
                        {member.email_confirmed_at ? new Date(member.email_confirmed_at).toLocaleString() : t('common.dash')}
                      </td>
                      <td className="py-2 pr-2">
                        {member.last_sign_in_at ? new Date(member.last_sign_in_at).toLocaleString() : t('common.dash')}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex justify-end">
                          <Button variant="outline" size="sm" onClick={(event) => openMember(member, event.currentTarget)}>
                            <UserCog className="h-4 w-4" />
                            {tt('users.reviewMember', 'Review member')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </>
          )}
        </CardContent>
      </Card>
        </>
      )}

      <Dialog open={Boolean(selectedMember)} onOpenChange={(open) => !open && setSelectedMember(null)}>
        <DialogContent
          className="max-w-2xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (memberReviewTriggerRef.current?.isConnected) {
              memberReviewTriggerRef.current.focus()
            }
            memberReviewTriggerRef.current = null
          }}
        >
          <DialogHeader>
            <DialogTitle>{tt('users.memberReviewTitle', 'Review member')}</DialogTitle>
            <DialogDescription>
              {tt('users.memberReviewHelp', 'Review company role and membership status. Backend role and ownership rules remain authoritative.')}
            </DialogDescription>
          </DialogHeader>
          {selectedMember ? (
            <DialogBody className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 p-4">
                  <div className="text-xs text-muted-foreground">{t('users.email')}</div>
                  <div className="mt-1 break-all font-medium">{selectedMember.email || tt('users.emailUnavailable', 'Email unavailable')}</div>
                </div>
                <div className="rounded-lg border border-border/70 p-4">
                  <div className="text-xs text-muted-foreground">{t('users.table.lastSignin')}</div>
                  <div className="mt-1 font-medium">
                    {selectedMember.last_sign_in_at
                      ? new Date(selectedMember.last_sign_in_at).toLocaleString()
                      : tt('users.notCaptured', 'Not captured')}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{tt('users.currentRole', 'Current role')}</Label>
                  <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">{roleLabel(selectedMember.role)}</div>
                </div>
                <div className="space-y-2">
                  <Label>{tt('users.newRole', 'New role')}</Label>
                  <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as Role)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((role) => (
                        <SelectItem key={role} value={role} disabled={!canAssignRole(myRole as import('../lib/roles').CompanyRole, role)}>
                          {roleLabel(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-muted/20 p-4 text-sm">
                <div className="font-medium">{roleLabel(selectedRole)}</div>
                <div className="mt-1 text-muted-foreground">{roleCopy.definitions[selectedRole].summary}</div>
              </div>

              <div className="space-y-2">
                <Label>{tt('users.membershipStatus', 'Membership status')}</Label>
                <Select value={selectedStatus} onValueChange={(value) => setSelectedStatus(value as Status)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['invited', 'active', 'disabled'] as Status[]).map((status) => (
                      <SelectItem key={status} value={status}>{statusLabel(status)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {tt('users.disableRemoveDistinction', 'Disabled membership retains historical evidence without active company access. Removing membership is a separate action and does not delete the authentication account.')}
                </p>
              </div>

              {higherThanMe(selectedMember.role) ? (
                <div role="status" className="rounded-lg border border-status-warning-border bg-status-warning-muted p-3 text-sm text-status-warning-foreground">
                  {tt('users.cannotModifyHigherRole', 'You cannot modify a member with a higher role than yours.')}
                </div>
              ) : null}
            </DialogBody>
          ) : null}
          <DialogFooter className="flex-wrap">
            {selectedMember?.status === 'invited' && selectedMember.email ? (
              <Button variant="outline" onClick={() => void reinvite(selectedMember.email!, selectedMember.role)}>
                {t('users.resendEmail')}
              </Button>
            ) : null}
            {selectedMember?.email ? (
              <Button
                variant="destructive"
                disabled={
                  selectedMember.email.toLowerCase() === (myEmail || '').toLowerCase() ||
                  higherThanMe(selectedMember.role)
                }
                onClick={async () => {
                  await removeMember(selectedMember.email!, selectedMember.role)
                  setSelectedMember(null)
                }}
              >
                {tt('users.removeMembership', 'Remove membership')}
              </Button>
            ) : null}
            <Button
              disabled={!selectedMember?.email || higherThanMe(selectedMember.role)}
              onClick={async () => {
                if (!selectedMember?.email) return
                await updateMember(
                  selectedMember.email,
                  { role: selectedRole, status: selectedStatus },
                  selectedMember.role,
                )
                setSelectedMember(null)
              }}
            >
              {tt('users.saveMemberChanges', 'Save member changes')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
