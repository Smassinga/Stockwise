import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, Mail } from 'lucide-react'
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

type Copy = {
  subtitle: string
  signInTitle: string
  signUpTitle: string
  signInBody: string
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
  submitSignIn: string
  submitSignUp: string
  loadingSignIn: string
  loadingSignUp: string
  forgot: string
  forgotMissingEmail: string
  waiting: string
  verifyTitle: string
  verifyBody: (email: string) => string
  resend: string
  resendDone: string
  goBackEdit: string
  verified: string
  signIn: string
  signUp: string
  switchToSignUp: string
  switchToSignIn: string
  verifyPlease: string
  accountCreated: string
  accountCreatedAndSignedIn: string
  resetSent: string
  resetFailed: string
  invalidCredentials: string
  accountExists: string
  genericLoginError: string
  genericSignUpError: string
  genericUnexpected: string
  signUpSupport: string
  wrongBrowserHint: string
  heroTitle: string
  heroBody: string
  highlights: string[]
  showPasswordLabel: string
  hidePasswordLabel: string
}

const copyByLang: Record<'en' | 'pt', Copy> = {
  en: {
    subtitle: 'Inventory operations, order execution, and cash visibility in one workspace.',
    signInTitle: 'Sign in to StockWise',
    signUpTitle: 'Create your StockWise account',
    signInBody: 'Access your dashboard, warehouses, orders, cash, and reports.',
    signUpBody: 'Create your login first, then continue straight to company setup.',
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
    passwordHint: 'Use at least 6 characters. You can change it later from your profile.',
    passwordTooShort: 'Use at least 6 characters for your password.',
    submitSignIn: 'Sign in',
    submitSignUp: 'Create account',
    loadingSignIn: 'Signing in...',
    loadingSignUp: 'Creating account...',
    forgot: 'Forgot password?',
    forgotMissingEmail: 'Enter your email address first.',
    waiting: 'Please wait...',
    verifyTitle: 'Check your inbox',
    verifyBody: (email) =>
      `We sent a verification link to ${email}. Open it in the same browser profile to finish signing in.`,
    resend: 'Resend verification email',
    resendDone: 'Verification email resent.',
    goBackEdit: 'Go back and edit',
    verified: 'Already verified?',
    signIn: 'Sign in',
    signUp: 'Sign up',
    switchToSignUp: 'Need an account? Create one',
    switchToSignIn: 'Already have an account? Sign in',
    verifyPlease: 'Verify your email before signing in.',
    accountCreated: 'Account created. Check your email to finish setup.',
    accountCreatedAndSignedIn: 'Account created. Continue with company setup.',
    resetSent: 'Password reset email sent.',
    resetFailed: 'We could not send a reset email right now. Please try again shortly.',
    invalidCredentials: 'Check your email and password, then try again.',
    accountExists: 'An account with this email already exists. Sign in or reset your password.',
    genericLoginError: 'We could not sign you in right now. Please try again.',
    genericSignUpError: 'We could not create your account right now. Please try again shortly.',
    genericUnexpected: 'An unexpected error occurred. Please try again.',
    signUpSupport:
      'After account creation, StockWise will either sign you in immediately or ask for email verification, depending on your workspace security settings.',
    wrongBrowserHint: 'Open verification and reset links in the same browser session you used here.',
    heroTitle: 'Keep stock, orders, and margin aligned.',
    heroBody:
      'StockWise is the operating layer for teams that need inventory movement, order flow, and financial visibility to stay connected.',
    highlights: [
      'Protected dashboard and internal routes',
      'Inventory, warehouses, cash, and reporting in one app',
      'EN/PT language toggle carried across public and authenticated screens',
    ],
    showPasswordLabel: 'Show password',
    hidePasswordLabel: 'Hide password',
  },
  pt: {
    subtitle: 'Operações de inventário, execução de encomendas e visibilidade de caixa num só workspace.',
    signInTitle: 'Iniciar sessão no StockWise',
    signUpTitle: 'Criar a sua conta no StockWise',
    signInBody: 'Aceda ao dashboard, armazéns, encomendas, caixa e relatórios.',
    signUpBody: 'Crie primeiro o seu acesso e siga diretamente para a configuração da empresa.',
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
    passwordHint: 'Use pelo menos 6 caracteres. Depois pode alterar a palavra-passe no perfil.',
    passwordTooShort: 'Use pelo menos 6 caracteres na palavra-passe.',
    submitSignIn: 'Iniciar sessão',
    submitSignUp: 'Criar conta',
    loadingSignIn: 'A iniciar sessão...',
    loadingSignUp: 'A criar conta...',
    forgot: 'Esqueceu-se da palavra-passe?',
    forgotMissingEmail: 'Introduza primeiro o seu e-mail.',
    waiting: 'Aguarde...',
    verifyTitle: 'Verifique o seu e-mail',
    verifyBody: (email) =>
      `Enviamos um link de verificação para ${email}. Abra-o no mesmo navegador para concluir a entrada.`,
    resend: 'Reenviar e-mail de verificação',
    resendDone: 'E-mail de verificação reenviado.',
    goBackEdit: 'Voltar e editar',
    verified: 'Já verificou o e-mail?',
    signIn: 'Iniciar sessão',
    signUp: 'Criar conta',
    switchToSignUp: 'Ainda não tem conta? Criar conta',
    switchToSignIn: 'Já tem conta? Iniciar sessão',
    verifyPlease: 'Verifique o seu e-mail antes de iniciar sessão.',
    accountCreated: 'Conta criada. Verifique o e-mail para concluir.',
    accountCreatedAndSignedIn: 'Conta criada. Continue para configurar a empresa.',
    resetSent: 'E-mail de recuperação enviado.',
    resetFailed: 'Não foi possível enviar o e-mail de recuperação agora. Tente novamente em instantes.',
    invalidCredentials: 'Confirme o email e a palavra-passe e tente novamente.',
    accountExists: 'Já existe uma conta com este e-mail. Inicie sessão ou recupere a palavra-passe.',
    genericLoginError: 'Não foi possível iniciar sessão agora. Tente novamente.',
    genericSignUpError: 'Não foi possível criar a conta agora. Tente novamente em instantes.',
    genericUnexpected: 'Ocorreu um erro inesperado. Tente novamente.',
    signUpSupport:
      'Depois de criar a conta, o StockWise vai iniciar sessão automaticamente ou pedir verificação por e-mail, conforme a política de segurança ativa.',
    wrongBrowserHint: 'Abra links de verificação e recuperação no mesmo navegador usado aqui.',
    heroTitle: 'Mantenha stock, encomendas e margem alinhados.',
    heroBody:
      'O StockWise liga movimento de inventário, fluxo de encomendas e visibilidade financeira num único workspace operacional.',
    highlights: [
      'Dashboard e rotas internas protegidas',
      'Inventário, armazéns, caixa e relatórios na mesma aplicação',
      'Alternância EN/PT preservada entre ecrãs públicos e autenticados',
    ],
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
  const [formData, setFormData] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [awaitingVerification, setAwaitingVerification] = useState<null | { email: string }>(null)
  const [resending, setResending] = useState(false)

  function handleInputChange(field: keyof typeof formData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (error) setError('')
  }

  function validateForm() {
    const email = normalizeEmail(formData.email)
    if (!email) return copy.emailRequired
    if (!isValidEmail(email)) return copy.emailInvalid
    if (!formData.password) return copy.passwordRequired
    if (!isLogin && !formData.name.trim()) return copy.nameRequired
    if (!isLogin && formData.password.length < MIN_PASSWORD_LENGTH) return copy.passwordTooShort
    return ''
  }

  function resetMode(nextIsLogin: boolean) {
    setIsLogin(nextIsLogin)
    setError('')
    setShowPassword(false)
    setFormData({ name: '', email: '', password: '' })
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
    setLoading(true)

    try {
      if (isLogin) {
        const result = await login(email, formData.password)
        if (!result.success) {
          const message = (result.error || '').toLowerCase()
          if (message.includes('not confirmed') || message.includes('confirm your email')) {
            setAwaitingVerification({ email })
            toast.success(copy.verifyPlease)
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
    else toast.success(copy.resetSent)
  }

  async function resendVerification() {
    if (!awaitingVerification?.email) return

    try {
      setResending(true)
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: awaitingVerification.email,
        options: { emailRedirectTo: buildAuthCallbackUrl() },
      })

      if (error) {
        toast.error(getFriendlyAuthError(copy, error.message, 'signup'))
        return
      }

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
      ? copy.signInBody
      : copy.signUpBody

  const canSubmit = isLogin
    ? !!normalizeEmail(formData.email) && !!formData.password && !loading
    : !!formData.name.trim() &&
      !!normalizeEmail(formData.email) &&
      formData.password.length >= MIN_PASSWORD_LENGTH &&
      !loading

  return (
    <PublicAuthShell
      subtitle={copy.subtitle}
      heroTitle={copy.heroTitle}
      heroBody={copy.heroBody}
      highlights={copy.highlights}
    >
      <Card className="border-border/70 bg-card/95 shadow-xl">
        <CardHeader className="space-y-3 pb-4">
          <CardTitle className="text-2xl font-semibold tracking-tight">{cardTitle}</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">{cardBody}</p>
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
              </div>

              <Button onClick={resendVerification} disabled={resending} className="w-full">
                <Mail className="h-4 w-4" />
                {resending ? copy.waiting : copy.resend}
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
            </div>
          ) : (
            <>
              {!isLogin ? (
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                  {copy.signUpSupport}
                </div>
              ) : null}

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div className="rounded-2xl border border-border/70 bg-background/70 p-4 sm:p-5">
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
                  </div>
                </div>

                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
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


