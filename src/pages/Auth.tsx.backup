// src/pages/Auth.tsx
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Eye, EyeOff, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import Logo from '../components/brand/Logo'
import ThemeToggle from '../components/ThemeToggle'
import { useI18n } from '../lib/i18n'

/**
 * This screen handles both Sign In and Sign Up.
 * When signing up (with email confirmation ON), we switch to a lightweight
 * "Verify your email" screen with a Resend button that points to /auth/callback.
 * When trying to sign in before confirming, we detect the specific Supabase error
 * and also switch to the same verification screen for that email.
 */
export default function Auth() {
  const { t } = useI18n()
  const [isLogin, setIsLogin] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [formData, setFormData] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // After sign-up or if sign-in fails with "Email not confirmed", show this
  const [awaitingVerification, setAwaitingVerification] = useState<null | { email: string }>(null)
  const [resending, setResending] = useState(false)

  const navigate = useNavigate()
  const { login, register, requestPasswordReset } = useAuth()

  function handleInputChange(field: keyof typeof formData, value: string) {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (error) setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (isLogin) {
        const res = await login(formData.email, formData.password)
        if (!res.success) {
          // If the project has email confirmations enabled, Supabase returns an error like
          // "Email not confirmed". Catch that and move the user to the verify screen.
          const msg = (res.error || '').toLowerCase()
          if (msg.includes('not confirmed') || msg.includes('confirm your email')) {
            setAwaitingVerification({ email: formData.email })
            toast(t('auth.toast.verifyPlease'), { icon: '📧' })
            return
          }
          setError(res.error || 'Login failed')
          return
        }
        navigate('/dashboard') // route guards will route to /onboarding if needed
        return
      }

      // SIGN UP (email confirm flow)
      const reg = await register(formData.name, formData.email, formData.password)
      if (!reg.success) {
        setError(reg.error || 'Registration failed')
        return
      }

      // Switch to "verify your email" screen
      setAwaitingVerification({ email: formData.email })
      toast.success(t('auth.toast.accountCreated'))
    } catch (err) {
      console.error(err)
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleResetPassword() {
    if (!formData.email) {
      setError('Enter your email above first')
      return
    }
    setLoading(true)
    const res = await requestPasswordReset(formData.email)
    setLoading(false)
    if (!res.success) setError(res.error || 'Failed to request password reset')
    else toast.success(t('auth.toast.resetSent'))
  }

  // Resend verification email to the same /auth/callback route
  async function resendVerification() {
    if (!awaitingVerification?.email) return
    try {
      setResending(true)
      // Use the same redirect URL building logic as in useAuth hook
      const APP_ORIGIN =
        (import.meta as any)?.env?.VITE_SITE_URL ?? window.location.origin;
      const AUTH_CALLBACK = `${APP_ORIGIN.replace(/\/\//, "")}/auth/callback`;
      
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: awaitingVerification.email,
        options: { emailRedirectTo: AUTH_CALLBACK },
      })
      if (error) toast.error(error.message)
      else toast.success('Verification email resent.')
    } finally {
      setResending(false)
    }
  }

  // --- UI: verify-email screen (shown after sign-up or unconfirmed sign-in) ---
  if (awaitingVerification) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="flex justify-end mb-2">
            <ThemeToggle />
          </div>

          <div className="text-center mb-8">
            <div className="flex items-center justify-center space-x-2 mb-4">
              <Logo h={44} alt="StockWise" />
              <span className="text-2xl font-bold">StockWise</span>
            </div>
            <p className="text-muted-foreground">Advanced Inventory Management System</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-center">{t('auth.verify.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground text-center">
                {t('auth.verify.desc', { email: awaitingVerification.email })}
              </div>

              <div className="flex items-center justify-center gap-2">
                <Button onClick={resendVerification} disabled={resending} className="min-w-[200px]">
                  <Mail className="h-4 w-4 mr-2" />
                  {resending ? 'Resending…' : t('auth.verify.resend')}
                </Button>
              </div>

              <div className="text-center text-xs text-muted-foreground">
                Wrong address?{' '}
                <Button
                  variant="link"
                  className="px-1"
                  onClick={() => {
                    setAwaitingVerification(null)
                    setIsLogin(false)
                  }}
                >
                  {t('auth.verify.goBackEdit')}
                </Button>
              </div>

              <div className="text-center text-xs text-muted-foreground">
                Already verified?{' '}
                <Button
                  variant="link"
                  className="px-1"
                  onClick={() => {
                    setAwaitingVerification(null)
                    setIsLogin(true)
                  }}
                >
                  {t('auth.verify.signIn')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // --- UI: default login / signup form ---
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-end mb-2">
          <ThemeToggle />
        </div>

        <div className="text-center mb-8">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <Logo h={44} alt="StockWise" />
            <span className="text-2xl font-bold">StockWise</span>
          </div>
          <p className="text-muted-foreground">Advanced Inventory Management System</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-center">
              {isLogin ? t('auth.title.signIn') : t('auth.title.signUp')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="name">{t('auth.field.fullName')}</Label>
                  <Input
                    id="name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    placeholder={t('auth.field.fullName')}
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">{t('auth.field.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  placeholder={t('auth.field.email')}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t('auth.field.password')}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => handleInputChange('password', e.target.value)}
                    placeholder={t('auth.field.password')}
                    required
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Please wait…' : (isLogin ? t('auth.action.submit.signIn') : t('auth.action.submit.signUp'))}
              </Button>
            </form>

            {isLogin && (
              <div className="mt-4 text-right">
                <Button variant="link" onClick={handleResetPassword}>
                  {t('auth.action.forgot')}
                </Button>
              </div>
            )}

            <div className="mt-6 text-center">
              <Button
                variant="link"
                onClick={() => {
                  setIsLogin(!isLogin)
                  setError('')
                  setFormData({ name: '', email: '', password: '' })
                }}
                className="text-sm"
              >
                {isLogin ? t('auth.switch.toSignUp') : t('auth.switch.toSignIn')}
              </Button>
            </div>

            {/* Small helper for verification-based flows */}
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Using email verification? Open the link in the <strong>same browser</strong> you used here.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
