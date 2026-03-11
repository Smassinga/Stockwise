import { type ReactNode, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Mail, ShieldCheck, Warehouse } from 'lucide-react'
import toast from 'react-hot-toast'
import BrandLockup from '../components/brand/BrandLockup'
import LocaleToggle from '../components/LocaleToggle'
import ThemeToggle from '../components/ThemeToggle'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../lib/i18n'
import { buildAuthCallbackUrl } from '../lib/authRedirect'
import { supabase } from '../lib/supabase'

type Copy = {
  subtitle: string
  signInTitle: string
  signUpTitle: string
  signInBody: string
  signUpBody: string
  name: string
  email: string
  password: string
  submitSignIn: string
  submitSignUp: string
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
  resetSent: string
  wrongBrowserHint: string
  heroTitle: string
  heroBody: string
  highlights: string[]
}

const copyByLang: Record<'en' | 'pt', Copy> = {
  en: {
    subtitle: 'Inventory operations, order execution, and cash visibility in one workspace.',
    signInTitle: 'Sign in to StockWise',
    signUpTitle: 'Create your StockWise workspace',
    signInBody: 'Access your dashboard, warehouses, orders, cash, and reports.',
    signUpBody: 'Set up your account and finish verification to start using StockWise.',
    name: 'Full name',
    email: 'Email',
    password: 'Password',
    submitSignIn: 'Sign in',
    submitSignUp: 'Create account',
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
    resetSent: 'Password reset email sent.',
    wrongBrowserHint: 'Open verification and reset links in the same browser session you used here.',
    heroTitle: 'Keep stock, orders, and margin aligned.',
    heroBody:
      'StockWise is the operating layer for teams that need inventory movement, order flow, and financial visibility to stay connected.',
    highlights: [
      'Protected dashboard and internal routes',
      'Inventory, warehouses, cash, and reporting in one app',
      'EN/PT language toggle carried across public and authenticated screens',
    ],
  },
  pt: {
    subtitle: 'Operações de inventário, execução de encomendas e visibilidade de caixa num só workspace.',
    signInTitle: 'Iniciar sessão no StockWise',
    signUpTitle: 'Criar a sua conta no StockWise',
    signInBody: 'Aceda ao dashboard, armazéns, encomendas, caixa e relatórios.',
    signUpBody: 'Crie a conta e conclua a verificação para começar a usar o StockWise.',
    name: 'Nome completo',
    email: 'Email',
    password: 'Palavra-passe',
    submitSignIn: 'Iniciar sessão',
    submitSignUp: 'Criar conta',
    forgot: 'Esqueceu-se da palavra-passe?',
    forgotMissingEmail: 'Introduza primeiro o seu email.',
    waiting: 'Aguarde...',
    verifyTitle: 'Verifique o seu email',
    verifyBody: (email) =>
      `Enviámos um link de verificação para ${email}. Abra-o no mesmo navegador para concluir a entrada.`,
    resend: 'Reenviar email de verificação',
    resendDone: 'Email de verificação reenviado.',
    goBackEdit: 'Voltar e editar',
    verified: 'Já verificou o email?',
    signIn: 'Iniciar sessão',
    signUp: 'Criar conta',
    switchToSignUp: 'Ainda não tem conta? Criar conta',
    switchToSignIn: 'Já tem conta? Iniciar sessão',
    verifyPlease: 'Verifique o seu email antes de iniciar sessão.',
    accountCreated: 'Conta criada. Verifique o email para concluir.',
    resetSent: 'Email de recuperação enviado.',
    wrongBrowserHint: 'Abra links de verificação e recuperação no mesmo navegador usado aqui.',
    heroTitle: 'Mantenha stock, encomendas e margem alinhados.',
    heroBody:
      'O StockWise é a camada operacional para equipas que precisam de ligar movimento de inventário, fluxo de encomendas e visibilidade financeira.',
    highlights: [
      'Dashboard e rotas internas protegidas',
      'Inventário, armazéns, caixa e relatórios na mesma aplicação',
      'Alternância EN/PT preservada entre ecrãs públicos e autenticados',
    ],
  },
}

function AuthShell({
  children,
  subtitle,
  heroTitle,
  heroBody,
  highlights,
}: {
  children: ReactNode
  subtitle: string
  heroTitle: string
  heroBody: string
  highlights: string[]
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="absolute inset-x-0 top-0 -z-10 h-[440px] bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.16),_transparent_44%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.16),_transparent_28%)]" />
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <Link to="/">
            <BrandLockup subtitle={subtitle} />
          </Link>
          <div className="flex items-center gap-2">
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center py-8 lg:py-12">
          <div className="grid w-full gap-8 lg:grid-cols-[1fr_460px] lg:items-center">
            <div className="hidden max-w-xl lg:block">
              <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-primary">
                <ShieldCheck className="mr-2 h-4 w-4" />
                StockWise
              </div>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight">{heroTitle}</h1>
              <p className="mt-5 text-lg leading-8 text-muted-foreground">{heroBody}</p>
              <div className="mt-8 space-y-3">
                {highlights.map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/85 p-4 shadow-sm">
                    <Warehouse className="mt-0.5 h-4 w-4 text-primary" />
                    <span className="text-sm text-muted-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (isLogin) {
        const result = await login(formData.email, formData.password)
        if (!result.success) {
          const message = (result.error || '').toLowerCase()
          if (message.includes('not confirmed') || message.includes('confirm your email')) {
            setAwaitingVerification({ email: formData.email })
            toast.success(copy.verifyPlease)
            return
          }
          setError(result.error || 'Login failed')
          return
        }

        navigate('/dashboard')
        return
      }

      const result = await register(formData.name, formData.email, formData.password)
      if (!result.success) {
        setError(result.error || 'Registration failed')
        return
      }

      setAwaitingVerification({ email: formData.email })
      toast.success(copy.accountCreated)
    } catch (err) {
      console.error(err)
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleResetPassword() {
    if (!formData.email) {
      setError(copy.forgotMissingEmail)
      return
    }

    setLoading(true)
    const result = await requestPasswordReset(formData.email)
    setLoading(false)

    if (!result.success) setError(result.error || 'Failed to request password reset')
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
        toast.error(error.message)
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

  return (
    <AuthShell
      subtitle={copy.subtitle}
      heroTitle={copy.heroTitle}
      heroBody={copy.heroBody}
      highlights={copy.highlights}
    >
      <Card className="border-border/70 bg-card/95 shadow-xl">
        <CardHeader className="space-y-3">
          <CardTitle className="text-2xl font-semibold tracking-tight">{cardTitle}</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">{cardBody}</p>
        </CardHeader>
        <CardContent>
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
                    setIsLogin(false)
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
                    setIsLogin(true)
                  }}
                >
                  {copy.signIn}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin ? (
                  <div className="space-y-2">
                    <Label htmlFor="name">{copy.name}</Label>
                    <Input
                      id="name"
                      type="text"
                      value={formData.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      placeholder={copy.name}
                      required
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
                    placeholder={copy.email}
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
                      placeholder={copy.password}
                      required
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? copy.waiting : isLogin ? copy.submitSignIn : copy.submitSignUp}
                </Button>
              </form>

              {isLogin ? (
                <div className="mt-4 text-right">
                  <Button variant="link" onClick={handleResetPassword}>
                    {copy.forgot}
                  </Button>
                </div>
              ) : null}

              <div className="mt-6 text-center">
                <Button
                  variant="link"
                  onClick={() => {
                    setIsLogin((value) => !value)
                    setError('')
                    setFormData({ name: '', email: '', password: '' })
                  }}
                >
                  {isLogin ? copy.switchToSignUp : copy.switchToSignIn}
                </Button>
              </div>
            </>
          )}

          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">{copy.wrongBrowserHint}</p>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
