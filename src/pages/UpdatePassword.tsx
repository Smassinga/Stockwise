import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import PublicAuthShell from '../components/auth/PublicAuthShell'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  clearPasswordRecoveryPending,
  hasPasswordRecoveryPending,
} from '../lib/authRecovery'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { withTimeout } from '../lib/withTimeout'

const MIN_UPDATE_PASSWORD_LENGTH = 8
const AUTH_REQUEST_TIMEOUT_MS = 15000
const SUPPORT_EMAIL = 'support@stockwiseapp.com'

type Copy = {
  subtitle: string
  title: string
  body: string
  password: string
  passwordPlaceholder: string
  passwordRequired: string
  passwordTooShort: string
  passwordHint: string
  confirmPassword: string
  confirmPasswordPlaceholder: string
  confirmPasswordRequired: string
  passwordsDontMatch: string
  submit: string
  loading: string
  checking: string
  successTitle: string
  successBody: string
  missingSession: string
  missingRecovery: string
  genericError: string
  backToLogin: string
  supportHint: string
  heroTitle: string
  heroBody: string
  highlights: string[]
  showPasswordLabel: string
  hidePasswordLabel: string
}

const copyByLang: Record<'en' | 'pt', Copy> = {
  en: {
    subtitle: 'Secure password update for your StockWise account.',
    title: 'Update your password',
    body: 'Choose a new password for your StockWise account. This screen is available only from a valid reset-password email.',
    password: 'New password',
    passwordPlaceholder: 'Enter a new password',
    passwordRequired: 'Enter a new password.',
    passwordTooShort: `Use at least ${MIN_UPDATE_PASSWORD_LENGTH} characters.`,
    passwordHint: `Use at least ${MIN_UPDATE_PASSWORD_LENGTH} characters. Avoid reusing passwords from other services.`,
    confirmPassword: 'Confirm new password',
    confirmPasswordPlaceholder: 'Re-enter the new password',
    confirmPasswordRequired: 'Confirm the new password.',
    passwordsDontMatch: 'Passwords do not match.',
    submit: 'Update password',
    loading: 'Updating password...',
    checking: 'Checking your reset session...',
    successTitle: 'Password updated',
    successBody: 'Your password was updated. Sign in again with the new password to continue.',
    missingSession: 'This reset link is no longer active. Request a new password reset email and open the latest link.',
    missingRecovery: 'Open the password reset link from your email to update your password.',
    genericError: 'We could not update your password right now. Request a new reset email and try again.',
    backToLogin: 'Back to login',
    supportHint: 'Need help?',
    heroTitle: 'Keep account access secure before returning to the workspace.',
    heroBody:
      'StockWise password recovery uses Supabase Auth and a verified email link before allowing the password to change.',
    highlights: [
      'The reset link establishes a temporary authenticated recovery session',
      'The new password is applied through Supabase Auth only',
      'After updating, sign in again to continue to onboarding or dashboard',
    ],
    showPasswordLabel: 'Show password',
    hidePasswordLabel: 'Hide password',
  },
  pt: {
    subtitle: 'Atualização segura da palavra-passe da sua conta StockWise.',
    title: 'Atualizar palavra-passe',
    body: 'Escolha uma nova palavra-passe para a sua conta StockWise. Este ecrã fica disponível apenas a partir de um email válido de recuperação.',
    password: 'Nova palavra-passe',
    passwordPlaceholder: 'Introduza uma nova palavra-passe',
    passwordRequired: 'Introduza uma nova palavra-passe.',
    passwordTooShort: `Use pelo menos ${MIN_UPDATE_PASSWORD_LENGTH} caracteres.`,
    passwordHint: `Use pelo menos ${MIN_UPDATE_PASSWORD_LENGTH} caracteres. Evite reutilizar palavras-passe de outros serviços.`,
    confirmPassword: 'Confirmar nova palavra-passe',
    confirmPasswordPlaceholder: 'Repita a nova palavra-passe',
    confirmPasswordRequired: 'Confirme a nova palavra-passe.',
    passwordsDontMatch: 'As palavras-passe não coincidem.',
    submit: 'Atualizar palavra-passe',
    loading: 'A atualizar palavra-passe...',
    checking: 'A verificar a sessão de recuperação...',
    successTitle: 'Palavra-passe atualizada',
    successBody: 'A sua palavra-passe foi atualizada. Inicie sessão novamente com a nova palavra-passe para continuar.',
    missingSession: 'Este link de recuperação já não está ativo. Peça um novo email de recuperação e abra o link mais recente.',
    missingRecovery: 'Abra o link de recuperação recebido por email para atualizar a palavra-passe.',
    genericError: 'Não foi possível atualizar a palavra-passe agora. Peça um novo email de recuperação e tente novamente.',
    backToLogin: 'Voltar ao login',
    supportHint: 'Precisa de ajuda?',
    heroTitle: 'Mantenha o acesso seguro antes de regressar ao workspace.',
    heroBody:
      'A recuperação de palavra-passe do StockWise usa Supabase Auth e um link de email verificado antes de permitir a alteração.',
    highlights: [
      'O link de recuperação cria uma sessão autenticada temporária',
      'A nova palavra-passe é aplicada apenas pelo Supabase Auth',
      'Depois de atualizar, inicie sessão novamente para continuar para onboarding ou dashboard',
    ],
    showPasswordLabel: 'Mostrar palavra-passe',
    hidePasswordLabel: 'Ocultar palavra-passe',
  },
}

function validate(copy: Copy, password: string, confirmPassword: string) {
  if (!password) return copy.passwordRequired
  if (password.length < MIN_UPDATE_PASSWORD_LENGTH) return copy.passwordTooShort
  if (!confirmPassword) return copy.confirmPasswordRequired
  if (password !== confirmPassword) return copy.passwordsDontMatch
  return ''
}

export default function UpdatePassword() {
  const { lang } = useI18n()
  const copy = copyByLang[lang]
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [checking, setChecking] = useState(true)
  const [canUpdate, setCanUpdate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const pendingRecovery = hasPasswordRecoveryPending()
        const {
          data: { session },
          error: sessionError,
        } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_REQUEST_TIMEOUT_MS,
          'password recovery session lookup',
        )

        if (cancelled) return
        if (sessionError || !session?.user) {
          setError(copy.missingSession)
          setCanUpdate(false)
          return
        }

        if (!pendingRecovery) {
          setError(copy.missingRecovery)
          setCanUpdate(false)
          return
        }

        setCanUpdate(true)
      } catch {
        if (!cancelled) {
          setError(copy.missingSession)
          setCanUpdate(false)
        }
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [copy.missingRecovery, copy.missingSession])

  function handleInputChange(next: string, field: 'password' | 'confirmPassword') {
    if (field === 'password') setPassword(next)
    else setConfirmPassword(next)
    if (error) setError('')
  }

  async function returnToLogin() {
    clearPasswordRecoveryPending()
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    const validationError = validate(copy, password, confirmPassword)
    if (validationError) {
      setError(validationError)
      return
    }

    setError('')
    setLoading(true)
    try {
      const { error: updateError } = await withTimeout(
        supabase.auth.updateUser({ password }),
        AUTH_REQUEST_TIMEOUT_MS,
        'password update',
      )
      if (updateError) throw updateError

      clearPasswordRecoveryPending()
      setSuccess(true)
      toast.success(copy.successTitle)
      await supabase.auth.signOut()
      window.setTimeout(() => navigate('/login', { replace: true }), 1800)
    } catch (err: any) {
      console.error('Password recovery update failed:', err?.message || err)
      setError(err?.message || copy.genericError)
    } finally {
      setLoading(false)
    }
  }

  const livePasswordHint =
    password && password.length < MIN_UPDATE_PASSWORD_LENGTH ? copy.passwordTooShort : copy.passwordHint
  const liveConfirmHint =
    confirmPassword && password !== confirmPassword ? copy.passwordsDontMatch : ''
  const submitDisabled = checking || !canUpdate || loading || success

  return (
    <PublicAuthShell
      subtitle={copy.subtitle}
      heroTitle={copy.heroTitle}
      heroBody={copy.heroBody}
      highlights={copy.highlights}
    >
      <Card className="border-border/70 bg-card/95 shadow-xl">
        <CardHeader className="space-y-3 pb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
            {success ? <CheckCircle2 className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
          </div>
          <CardTitle className="text-2xl font-semibold tracking-tight">
            {success ? copy.successTitle : copy.title}
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            {success ? copy.successBody : copy.body}
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {checking ? (
            <Alert>
              <AlertDescription>{copy.checking}</AlertDescription>
            </Alert>
          ) : null}

          {success ? (
            <Alert>
              <AlertDescription>{copy.successBody}</AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant={canUpdate ? 'destructive' : undefined}>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {!success ? (
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div className="rounded-2xl border border-border/70 bg-background/70 p-4 sm:p-5">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-password">{copy.password}</Label>
                    <div className="relative">
                      <Input
                        id="new-password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(event) => handleInputChange(event.target.value, 'password')}
                        placeholder={copy.passwordPlaceholder}
                        className="pr-12"
                        required
                        minLength={MIN_UPDATE_PASSWORD_LENGTH}
                        autoComplete="new-password"
                        disabled={!canUpdate || loading}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={showPassword ? copy.hidePasswordLabel : copy.showPasswordLabel}
                        disabled={!canUpdate || loading}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">{livePasswordHint}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-new-password">{copy.confirmPassword}</Label>
                    <Input
                      id="confirm-new-password"
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(event) => handleInputChange(event.target.value, 'confirmPassword')}
                      placeholder={copy.confirmPasswordPlaceholder}
                      required
                      minLength={MIN_UPDATE_PASSWORD_LENGTH}
                      autoComplete="new-password"
                      disabled={!canUpdate || loading}
                    />
                    {liveConfirmHint ? (
                      <p className="text-xs leading-5 text-destructive">{liveConfirmHint}</p>
                    ) : null}
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={submitDisabled}>
                {loading ? copy.loading : copy.submit}
                {!loading ? <ArrowRight className="h-4 w-4" /> : null}
              </Button>
            </form>
          ) : null}

          <Button type="button" variant="outline" className="w-full" onClick={() => void returnToLogin()}>
            {copy.backToLogin}
          </Button>

          <p className="text-center text-xs leading-5 text-muted-foreground">
            {copy.supportHint}{' '}
            <a className="font-medium text-primary underline-offset-4 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
              <Mail className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
              {SUPPORT_EMAIL}
            </a>
          </p>
        </CardContent>
      </Card>
    </PublicAuthShell>
  )
}
