import { ArrowRight, CircleAlert, Loader2, Mail, RefreshCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PublicAuthShell from '../components/auth/PublicAuthShell'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { rememberCompanyLocally } from '../lib/companySelectionMemory'
import { useI18n } from '../lib/i18n'
import { readInviteToken, stashInviteToken } from '../lib/inviteToken'
import { getInviteErrorCode, redeemStoredInviteToken } from '../lib/onboardingInvites'
import { supabase } from '../lib/supabase'
import { withTimeout } from '../lib/withTimeout'

const SESSION_LOOKUP_TIMEOUT_MS = 5000

type InvitePageState = 'loading' | 'needs_auth' | 'error'

const copyByLang = {
  en: {
    subtitle: 'Secure company access starts from the right account and the right workspace.',
    heroTitle: 'Review your company invitation.',
    heroBody:
      'StockWise invitation links stay bound to the invited email address. Sign in with that account to join the intended company securely.',
    highlights: [
      'Invitation acceptance stays tied to the invited email address',
      'Expired or invalid invite links stop before company access changes',
      'You can still create your own company later from onboarding if needed',
    ],
    processingTitle: 'Checking your invitation',
    processingBody: 'Validating the invite and your current session before joining the company.',
    signInPrompt: 'Sign in or create an account with the invited email address to continue.',
    signInCta: 'Go to sign-in',
    useDifferentCta: 'Use a different account',
    wrongAccountTitle: 'This invite belongs to another email address.',
    wrongAccountBody:
      'Sign out and continue with the email address that received the invitation. StockWise will not expose the company to the wrong account.',
    invalidTitle: 'This invitation is no longer available.',
    invalidBody:
      'The invite link is invalid, expired, or has already been used. Ask the company administrator to send a fresh invitation.',
    genericTitle: 'We could not process this invitation.',
    genericBody: 'Try again once, or contact the inviting company if the problem continues.',
    retry: 'Retry invitation',
    backToSignIn: 'Back to sign-in',
  },
  pt: {
    subtitle: 'O acesso seguro à empresa começa com a conta certa e o workspace certo.',
    heroTitle: 'Reveja o seu convite de empresa.',
    heroBody:
      'Os links de convite do StockWise ficam associados ao email convidado. Inicie sessão com essa conta para entrar na empresa correta com segurança.',
    highlights: [
      'A aceitação do convite continua ligada ao email convidado',
      'Convites expirados ou inválidos param antes de qualquer mudança de acesso',
      'Se precisar, continua a poder criar a sua própria empresa mais tarde no onboarding',
    ],
    processingTitle: 'A validar o seu convite',
    processingBody: 'A confirmar o convite e a sua sessão atual antes de entrar na empresa.',
    signInPrompt: 'Inicie sessão ou crie uma conta com o email convidado para continuar.',
    signInCta: 'Ir para o login',
    useDifferentCta: 'Usar outra conta',
    wrongAccountTitle: 'Este convite pertence a outro endereço de email.',
    wrongAccountBody:
      'Termine a sessão e continue com o email que recebeu o convite. O StockWise não expõe a empresa à conta errada.',
    invalidTitle: 'Este convite já não está disponível.',
    invalidBody:
      'O link do convite é inválido, expirou ou já foi utilizado. Peça ao administrador da empresa para enviar um novo convite.',
    genericTitle: 'Não foi possível processar este convite.',
    genericBody: 'Tente novamente uma vez ou contacte a empresa que o convidou se o problema continuar.',
    retry: 'Tentar convite novamente',
    backToSignIn: 'Voltar ao login',
  },
} as const

export default function AcceptInvite() {
  const nav = useNavigate()
  const { lang } = useI18n()
  const copy = copyByLang[lang]
  const [state, setState] = useState<InvitePageState>('loading')
  const [errorCode, setErrorCode] = useState<'wrong_account' | 'invalid' | 'generic' | null>(null)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        setState('loading')
        setErrorCode(null)

        const url = new URL(window.location.href)
        const tokenFromUrl = url.searchParams.get('token')?.trim()
        if (tokenFromUrl) stashInviteToken(tokenFromUrl)

        const token = tokenFromUrl || readInviteToken()
        if (!token) {
          setState('error')
          setErrorCode('invalid')
          return
        }

        const {
          data: { session },
        } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_LOOKUP_TIMEOUT_MS,
          'invite session lookup',
        )

        if (!session?.user) {
          if (!cancelled) setState('needs_auth')
          return
        }

        const result = await redeemStoredInviteToken()
        if (cancelled) return

        if (result.status === 'accepted') {
          rememberCompanyLocally(result.companyId)
          nav('/dashboard', { replace: true })
          return
        }

        if (result.status === 'none') {
          setState('error')
          setErrorCode('invalid')
          return
        }

        const code = getInviteErrorCode({ message: result.rawMessage || result.code })
        setState('error')
        setErrorCode(code === 'email_mismatch' ? 'wrong_account' : code === 'invalid_or_expired' ? 'invalid' : 'generic')
      } catch (error: any) {
        if (cancelled) return
        console.warn('invite accept flow failed:', error?.message || error)
        setState('error')
        setErrorCode('generic')
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [nav])

  async function switchAccount() {
    await supabase.auth.signOut()
    nav('/login', { replace: true })
  }

  const title =
    state === 'needs_auth'
      ? copy.processingTitle
      : errorCode === 'wrong_account'
        ? copy.wrongAccountTitle
        : errorCode === 'invalid'
          ? copy.invalidTitle
          : errorCode === 'generic'
            ? copy.genericTitle
            : copy.processingTitle

  const body =
    state === 'needs_auth'
      ? copy.signInPrompt
      : errorCode === 'wrong_account'
        ? copy.wrongAccountBody
        : errorCode === 'invalid'
          ? copy.invalidBody
          : errorCode === 'generic'
            ? copy.genericBody
            : copy.processingBody

  return (
    <PublicAuthShell
      subtitle={copy.subtitle}
      heroTitle={copy.heroTitle}
      heroBody={copy.heroBody}
      highlights={copy.highlights}
    >
      <Card className="border-border/70 bg-card/95 shadow-xl">
        <CardHeader className="space-y-3 pb-4">
          <CardTitle>{title}</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">{body}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {state === 'loading' ? (
            <div className="rounded-2xl border border-primary/15 bg-primary/5 p-5 text-sm text-muted-foreground">
              <div className="flex items-center gap-3 font-medium text-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {copy.processingTitle}
              </div>
              <p className="mt-2 leading-6">{copy.processingBody}</p>
            </div>
          ) : null}

          {state === 'needs_auth' ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                {copy.signInPrompt}
              </div>
              <Button className="w-full" onClick={() => nav('/login', { replace: true })}>
                <Mail className="h-4 w-4" />
                {copy.signInCta}
              </Button>
            </div>
          ) : null}

          {state === 'error' ? (
            <>
              <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
                <CircleAlert className="h-4 w-4" />
                <AlertDescription>{body}</AlertDescription>
              </Alert>
              <div className="flex flex-col gap-3 sm:flex-row">
                {errorCode === 'wrong_account' ? (
                  <Button onClick={() => void switchAccount()} className="sm:flex-1">
                    <ArrowRight className="h-4 w-4" />
                    {copy.useDifferentCta}
                  </Button>
                ) : null}
                <Button
                  variant={errorCode === 'wrong_account' ? 'secondary' : 'default'}
                  onClick={() => window.location.reload()}
                  className="sm:flex-1"
                >
                  <RefreshCcw className="h-4 w-4" />
                  {copy.retry}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => nav('/login', { replace: true })}
                  className="sm:flex-1"
                >
                  {copy.backToSignIn}
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </PublicAuthShell>
  )
}
