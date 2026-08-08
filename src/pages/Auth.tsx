import { useEffect, useState } from 'react'
import { ArrowRight, Eye, EyeOff, Mail, RefreshCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import PublicAuthShell from '../components/auth/PublicAuthShell'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useAuth } from '../hooks/useAuth'
import { buildAuthCallbackUrl } from '../lib/authRedirect'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'

const MIN_PASSWORD_LENGTH = 6
const RESEND_COOLDOWN_SECONDS = 60
const SUPPORT_EMAIL = 'geral@stockwiseapp.com'

type Copy = {
  signInTitle: string
  signUpTitle: string
  signUpBody: string
  name: string
  namePlaceholder: string
  nameRequired: string
  email: string
  emailPlaceholder: string
  emailRequired: string
  emailInvalid: string
  password: string
  passwordPlaceholder: string
  passwordRequired: string
  passwordHint: string
  passwordTooShort: string
  confirmPassword: string
  confirmPasswordPlaceholder: string
  confirmPasswordRequired: string
  passwordsDontMatch: string
  submitSignIn: string
  submitSignUp: string
  loadingSignIn: string
  loadingSignUp: string
  forgot: string
  forgotMissingEmail: string
  waiting: string
  verifyTitle: string
  verifyBody: (email: string) => string
  verifyEmailLabel: string
  resend: string
  resendIn: (seconds: number) => string
  resendDone: string
  resendFailed: string
  goBackEdit: string
  verified: string
  backToLogin: string
  signIn: string
  signUp: string
  switchToSignUp: string
  switchToSignIn: string
  verifyPlease: string
  unconfirmedInline: string
  verificationSentInline: string
  accountCreated: string
  accountCreatedAndSignedIn: string
  resetSent: string
  resetFailed: string
  invalidCredentials: string
  accountExists: string
  genericLoginError: string
  genericSignUpError: string
  genericUnexpected: string
  supportHint: string
  wrongBrowserHint: string
  contextTitle: string
  contextBody: string
  showPasswordLabel: string
  hidePasswordLabel: string
}

const copyByLang: Record<'en' | 'pt', Copy> = {
  en: {
    signInTitle: 'Sign in to StockWise',
    signUpTitle: 'Create your StockWise account',
    signUpBody: 'Create your login first, confirm your email, then choose company setup or an invitation.',
    name: 'Full name',
    namePlaceholder: 'Full name',
    nameRequired: 'Enter your full name.',
    email: 'Email',
    emailPlaceholder: 'name@company.com',
    emailRequired: 'Enter your email address.',
    emailInvalid: 'Enter a valid email address.',
    password: 'Password',
    passwordPlaceholder: 'Enter your password',
    passwordRequired: 'Enter your password.',
    passwordHint: 'Use at least 6 characters. A secure change link is available from your profile later.',
    passwordTooShort: 'Use at least 6 characters for your password.',
    confirmPassword: 'Confirm password',
    confirmPasswordPlaceholder: 'Re-enter your password',
    confirmPasswordRequired: 'Confirm your password.',
    passwordsDontMatch: 'Passwords do not match.',
    submitSignIn: 'Sign in',
    submitSignUp: 'Create account',
    loadingSignIn: 'Signing in...',
    loadingSignUp: 'Creating account...',
    forgot: 'Forgot password?',
    forgotMissingEmail: 'Enter your email address first.',
    waiting: 'Please wait...',
    verifyTitle: 'Check your inbox',
    verifyBody: (email) =>
      `We sent a verification link to ${email}. Open it in the same browser profile to finish signing in. After confirming your email, you can create your company or accept a company invitation.`,
    verifyEmailLabel: 'Verification email',
    resend: 'Resend verification email',
    resendIn: (seconds) => `Resend available in ${seconds}s`,
    resendDone: 'Verification email resent.',
    resendFailed: 'We could not resend the verification email right now. Please try again shortly.',
    goBackEdit: 'Go back and edit',
    verified: 'Already verified?',
    backToLogin: 'Back to login',
    signIn: 'Sign in',
    signUp: 'Sign up',
    switchToSignUp: 'Need an account? Create one',
    switchToSignIn: 'Already have an account? Sign in',
    verifyPlease: 'Verify your email before signing in.',
    unconfirmedInline: 'This account exists but the email is not confirmed yet. Resend the verification email, then sign in after confirming it.',
    verificationSentInline: 'Check your inbox for the verification link. The resend button is rate-limited for 60 seconds.',
    accountCreated: 'Account created. Check your email to finish setup.',
    accountCreatedAndSignedIn: 'Account created. Continue with company setup.',
    resetSent: 'Password reset email sent.',
    resetFailed: 'We could not send a reset email right now. Please try again shortly.',
    invalidCredentials: 'Check your email and password, then try again.',
    accountExists: 'An account with this email already exists. Sign in or reset your password.',
    genericLoginError: 'We could not sign you in right now. Please try again.',
    genericSignUpError: 'We could not create your account right now. Please try again shortly.',
    genericUnexpected: 'An unexpected error occurred. Please try again.',
    supportHint: 'Need help?',
    wrongBrowserHint: 'Open verification and reset links in the same browser session you used here.',
    contextTitle: 'Return to the records your operation needs.',
    contextBody: 'Sign in to review connected purchases, stock, sales, documents, settlements, and the items that need attention.',
    showPasswordLabel: 'Show password',
    hidePasswordLabel: 'Hide password',
  },
  pt: {
    signInTitle: 'Iniciar sessão no StockWise',
    signUpTitle: 'Criar a sua conta no StockWise',
    signUpBody: 'Crie o seu acesso, confirme o email e depois escolha configurar a empresa ou aceitar um convite.',
    name: 'Nome completo',
    namePlaceholder: 'Nome completo',
    nameRequired: 'Introduza o seu nome completo.',
    email: 'Email',
    emailPlaceholder: 'nome@empresa.com',
    emailRequired: 'Introduza o seu e-mail.',
    emailInvalid: 'Introduza um e-mail válido.',
    password: 'Palavra-passe',
    passwordPlaceholder: 'Introduza a sua palavra-passe',
    passwordRequired: 'Introduza a sua palavra-passe.',
    passwordHint: 'Use pelo menos 6 caracteres. Mais tarde, pode pedir no perfil um link seguro de alteração.',
    passwordTooShort: 'Use pelo menos 6 caracteres na palavra-passe.',
    confirmPassword: 'Confirmar palavra-passe',
    confirmPasswordPlaceholder: 'Repita a sua palavra-passe',
    confirmPasswordRequired: 'Confirme a sua palavra-passe.',
    passwordsDontMatch: 'As palavras-passe não coincidem.',
    submitSignIn: 'Iniciar sessão',
    submitSignUp: 'Criar conta',
    loadingSignIn: 'A iniciar sessão...',
    loadingSignUp: 'A criar conta...',
    forgot: 'Esqueceu-se da palavra-passe?',
    forgotMissingEmail: 'Introduza primeiro o seu e-mail.',
    waiting: 'Aguarde...',
    verifyTitle: 'Verifique o seu e-mail',
    verifyBody: (email) =>
      `Enviámos um link de verificação para ${email}. Abra-o no mesmo navegador para concluir a entrada. Depois de confirmar o email, pode criar a sua empresa ou aceitar um convite de empresa.`,
    verifyEmailLabel: 'Email de verificação',
    resend: 'Reenviar e-mail de verificação',
    resendIn: (seconds) => `Reenvio disponível em ${seconds}s`,
    resendDone: 'E-mail de verificação reenviado.',
    resendFailed: 'Não foi possível reenviar o e-mail de verificação agora. Tente novamente em instantes.',
    goBackEdit: 'Voltar e editar',
    verified: 'Já verificou o e-mail?',
    backToLogin: 'Voltar ao login',
    signIn: 'Iniciar sessão',
    signUp: 'Criar conta',
    switchToSignUp: 'Ainda não tem conta? Criar conta',
    switchToSignIn: 'Já tem conta? Iniciar sessão',
    verifyPlease: 'Verifique o seu e-mail antes de iniciar sessão.',
    unconfirmedInline: 'Esta conta existe, mas o email ainda não foi confirmado. Reenvie o email de verificação e inicie sessão depois de confirmar.',
    verificationSentInline: 'Verifique a caixa de entrada para abrir o link de verificação. O reenvio fica limitado durante 60 segundos.',
    accountCreated: 'Conta criada. Verifique o e-mail para concluir.',
    accountCreatedAndSignedIn: 'Conta criada. Continue para configurar a empresa.',
    resetSent: 'E-mail de recuperação enviado.',
    resetFailed: 'Não foi possível enviar o e-mail de recuperação agora. Tente novamente em instantes.',
    invalidCredentials: 'Confirme o email e a palavra-passe e tente novamente.',
    accountExists: 'Já existe uma conta com este e-mail. Inicie sessão ou recupere a palavra-passe.',
    genericLoginError: 'Não foi possível iniciar sessão agora. Tente novamente.',
    genericSignUpError: 'Não foi possível criar a conta agora. Tente novamente em instantes.',
    genericUnexpected: 'Ocorreu um erro inesperado. Tente novamente.',
    supportHint: 'Precisa de ajuda?',
    wrongBrowserHint: 'Abra links de verificação e recuperação no mesmo navegador usado aqui.',
    contextTitle: 'Volte aos registos de que a operação precisa.',
    contextBody: 'Inicie sessão para rever compras, stock, vendas, documentos, liquidações e os pontos que precisam de atenção.',
    showPasswordLabel: 'Mostrar palavra-passe',
    hidePasswordLabel: 'Ocultar palavra-passe',
  },
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function isValidEmail(value: string) {
  return /^\S+@\S+\.\S+$/.test(value)
}

function getFriendlyAuthError(copy: Copy, rawError: string | undefined, mode: 'login' | 'signup' | 'reset') {
  const message = (rawError || '').trim()
  const lower = message.toLowerCase()

  if (mode === 'login') {
    if (lower.includes('invalid login credentials')) return copy.invalidCredentials
    if (lower.includes('not confirmed') || lower.includes('confirm your email')) return copy.verifyPlease
    return copy.genericLoginError
  }

  if (mode === 'signup') {
    if (lower.includes('already registered') || lower.includes('user already registered')) {
      return copy.accountExists
    }
    if (lower.includes('password should be at least')) return copy.passwordTooShort
    if (lower.includes('sending confirmation email')) return copy.genericSignUpError
    return copy.genericSignUpError
  }

  return copy.resetFailed
}

export default function Auth() {
  const { lang } = useI18n()
  const copy = copyByLang[lang]
  const navigate = useNavigate()
  const { login, register, requestPasswordReset } = useAuth()

  const [isLogin, setIsLogin] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [error, setError] = useState('')
  const [resetMessage, setResetMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [awaitingVerification, setAwaitingVerification] = useState<null | { email: string }>(null)
  const [resending, setResending] = useState(false)
  const [verificationMessage, setVerificationMessage] = useState('')
  const [resendAvailableAt, setResendAvailableAt] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!resendAvailableAt || resendAvailableAt <= Date.now()) return undefined

    const id = window.setInterval(() => {
      const current = Date.now()
      setNowMs(current)
      if (current >= resendAvailableAt) {
        setResendAvailableAt(0)
        window.clearInterval(id)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [resendAvailableAt])

  function handleInputChange(field: keyof typeof formData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (error) setError('')
    if (resetMessage) setResetMessage('')
  }

  function startResendCooldown() {
    const nextAvailableAt = Date.now() + RESEND_COOLDOWN_SECONDS * 1000
    setNowMs(Date.now())
    setResendAvailableAt(nextAvailableAt)
  }

  function validateForm() {
    const email = normalizeEmail(formData.email)
    if (!email) return copy.emailRequired
    if (!isValidEmail(email)) return copy.emailInvalid
    if (!formData.password) return copy.passwordRequired
    if (!isLogin && !formData.name.trim()) return copy.nameRequired
    if (!isLogin && formData.password.length < MIN_PASSWORD_LENGTH) return copy.passwordTooShort
    if (!isLogin && !formData.confirmPassword) return copy.confirmPasswordRequired
    if (!isLogin && formData.password !== formData.confirmPassword) return copy.passwordsDontMatch
    return ''
  }

  function resetMode(nextIsLogin: boolean) {
    setIsLogin(nextIsLogin)
    setError('')
    setResetMessage('')
    setVerificationMessage('')
    setResendAvailableAt(0)
    setShowPassword(false)
    setFormData({ name: '', email: '', password: '', confirmPassword: '' })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    const email = normalizeEmail(formData.email)
    const name = formData.name.trim()

    setError('')
    setResetMessage('')
    setLoading(true)

    try {
      if (isLogin) {
        const result = await login(email, formData.password)
        if (!result.success) {
          const message = (result.error || '').toLowerCase()
          if (message.includes('not confirmed') || message.includes('confirm your email')) {
            setAwaitingVerification({ email })
            setVerificationMessage(copy.unconfirmedInline)
            setResendAvailableAt(0)
            toast.error(copy.verifyPlease)
            return
          }
          setError(getFriendlyAuthError(copy, result.error, 'login'))
          return
        }

        navigate('/dashboard', { replace: true })
        return
      }

      const result = await register(name, email, formData.password)
      if (!result.success) {
        setError(getFriendlyAuthError(copy, result.error, 'signup'))
        return
      }

      if (result.signedIn) {
        toast.success(copy.accountCreatedAndSignedIn)
        navigate('/onboarding', { replace: true })
        return
      }

      setAwaitingVerification({ email })
      setVerificationMessage(copy.verificationSentInline)
      startResendCooldown()
      toast.success(copy.accountCreated)
    } catch (err) {
      console.error(err)
      setError(copy.genericUnexpected)
    } finally {
      setLoading(false)
    }
  }

  async function handleResetPassword() {
    const email = normalizeEmail(formData.email)
    if (!email) {
      setError(copy.forgotMissingEmail)
      return
    }
    if (!isValidEmail(email)) {
      setError(copy.emailInvalid)
      return
    }

    setLoading(true)
    const result = await requestPasswordReset(email)
    setLoading(false)

    if (!result.success) setError(getFriendlyAuthError(copy, result.error, 'reset'))
    else {
      setResetMessage(copy.resetSent)
      toast.success(copy.resetSent)
    }
  }

  async function resendVerification() {
    if (!awaitingVerification?.email) return

    try {
      setResending(true)
      setError('')
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: awaitingVerification.email,
        options: { emailRedirectTo: buildAuthCallbackUrl() },
      })

      if (error) {
        const message = getFriendlyAuthError(copy, error.message, 'signup') || copy.resendFailed
        setVerificationMessage(message)
        toast.error(message)
        return
      }

      setVerificationMessage(copy.resendDone)
      startResendCooldown()
      toast.success(copy.resendDone)
    } finally {
      setResending(false)
    }
  }

  const cardTitle = awaitingVerification
    ? copy.verifyTitle
    : isLogin
      ? copy.signInTitle
      : copy.signUpTitle

  const cardBody = awaitingVerification
    ? copy.verifyBody(awaitingVerification.email)
    : isLogin
      ? null
      : copy.signUpBody

  const resendRemainingSeconds = Math.max(0, Math.ceil((resendAvailableAt - nowMs) / 1000))
  const canResend = !resending && resendRemainingSeconds <= 0

  const canSubmit = isLogin
    ? !!normalizeEmail(formData.email) && !!formData.password && !loading
    : !!formData.name.trim() &&
      !!normalizeEmail(formData.email) &&
      formData.password.length >= MIN_PASSWORD_LENGTH &&
      formData.password === formData.confirmPassword &&
      !loading

  return (
    <PublicAuthShell
      contextTitle={copy.contextTitle}
      contextBody={copy.contextBody}
    >
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="space-y-3 pb-4">
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight">{cardTitle}</h1>
          </CardTitle>
          {cardBody ? <p className="text-sm leading-6 text-muted-foreground">{cardBody}</p> : null}
        </CardHeader>
        <CardContent className="space-y-5">
          {awaitingVerification ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Mail className="h-4 w-4 text-primary" />
                  {copy.verifyTitle}
                </div>
                <p className="mt-2 leading-6">{copy.verifyBody(awaitingVerification.email)}</p>
                <div className="mt-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {copy.verifyEmailLabel}
                  </p>
                  <p className="mt-1 break-all font-medium text-foreground">{awaitingVerification.email}</p>
                </div>
              </div>

              {verificationMessage ? (
                <Alert>
                  <AlertDescription>{verificationMessage}</AlertDescription>
                </Alert>
              ) : null}

              <Button onClick={resendVerification} disabled={!canResend} className="w-full">
                {resending ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {resending
                  ? copy.waiting
                  : resendRemainingSeconds > 0
                    ? copy.resendIn(resendRemainingSeconds)
                    : copy.resend}
              </Button>

              <div className="text-center text-sm text-muted-foreground">
                <Button
                  type="button"
                  variant="link"
                  className="px-1"
                  onClick={() => {
                    setAwaitingVerification(null)
                    resetMode(false)
                  }}
                >
                  {copy.goBackEdit}
                </Button>
              </div>

              <div className="text-center text-sm text-muted-foreground">
                {copy.verified}{' '}
                <Button
                  type="button"
                  variant="link"
                  className="px-1"
                  onClick={() => {
                    setAwaitingVerification(null)
                    resetMode(true)
                  }}
                >
                  {copy.signIn}
                </Button>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setAwaitingVerification(null)
                  resetMode(true)
                }}
              >
                {copy.backToLogin}
              </Button>

              <p className="text-center text-xs leading-5 text-muted-foreground">
                {copy.supportHint}{' '}
                <a className="font-medium text-primary underline-offset-4 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </a>
              </p>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div className="space-y-4">
                    {!isLogin ? (
                      <div className="space-y-2">
                        <Label htmlFor="name">{copy.name}</Label>
                        <Input
                          id="name"
                          type="text"
                          value={formData.name}
                          onChange={(e) => handleInputChange('name', e.target.value)}
                          placeholder={copy.namePlaceholder}
                          required
                          autoComplete="name"
                        />
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <Label htmlFor="email">{copy.email}</Label>
                      <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        placeholder={copy.emailPlaceholder}
                        required
                        autoComplete="email"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="password">{copy.password}</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          value={formData.password}
                          onChange={(e) => handleInputChange('password', e.target.value)}
                          placeholder={copy.passwordPlaceholder}
                          className="pr-12"
                          required
                          minLength={isLogin ? undefined : MIN_PASSWORD_LENGTH}
                          autoComplete={isLogin ? 'current-password' : 'new-password'}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowPassword((value) => !value)}
                          aria-label={showPassword ? copy.hidePasswordLabel : copy.showPasswordLabel}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                      {!isLogin ? (
                        <p className="text-xs leading-5 text-muted-foreground">{copy.passwordHint}</p>
                      ) : null}
                    </div>

                    {!isLogin ? (
                      <div className="space-y-2">
                        <Label htmlFor="confirmPassword">{copy.confirmPassword}</Label>
                        <Input
                          id="confirmPassword"
                          type={showPassword ? 'text' : 'password'}
                          value={formData.confirmPassword}
                          onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                          placeholder={copy.confirmPasswordPlaceholder}
                          required
                          minLength={MIN_PASSWORD_LENGTH}
                          autoComplete="new-password"
                        />
                      </div>
                    ) : null}
                </div>

                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                {resetMessage ? (
                  <Alert>
                    <AlertDescription>{resetMessage}</AlertDescription>
                  </Alert>
                ) : null}

                <Button type="submit" className="w-full" disabled={!canSubmit}>
                  {loading
                    ? isLogin
                      ? copy.loadingSignIn
                      : copy.loadingSignUp
                    : isLogin
                      ? copy.submitSignIn
                      : copy.submitSignUp}
                  {!loading ? <ArrowRight className="h-4 w-4" /> : null}
                </Button>
              </form>

              {isLogin ? (
                <div className="text-right">
                  <Button variant="link" onClick={handleResetPassword} disabled={loading}>
                    {copy.forgot}
                  </Button>
                </div>
              ) : null}

              <div className="text-center">
                <Button
                  variant="link"
                  onClick={() => resetMode(!isLogin)}
                  disabled={loading}
                >
                  {isLogin ? copy.switchToSignUp : copy.switchToSignIn}
                </Button>
              </div>
            </>
          )}

          <p className="text-center text-xs leading-5 text-muted-foreground">{copy.wrongBrowserHint}</p>
        </CardContent>
      </Card>
    </PublicAuthShell>
  )
}


