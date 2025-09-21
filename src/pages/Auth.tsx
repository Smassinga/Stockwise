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

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [formData, setFormData] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // NEW: after sign-up, we show a verification screen
  const [awaitingVerification, setAwaitingVerification] = useState<null | { email: string }>(null)
  const [resending, setResending] = useState(false)

  const navigate = useNavigate()
  const { login, register, requestPasswordReset } = useAuth()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (isLogin) {
        const res = await login(formData.email, formData.password)
        if (!res.success) {
          setError(res.error || 'Login failed')
          return
        }
        navigate('/dashboard') // route guards will push to /onboarding if no company
        return
      }

      // SIGN UP (email confirm flow)
      const reg = await register(formData.name, formData.email, formData.password)
      if (!reg.success) {
        setError(reg.error || 'Registration failed')
        return
      }

      // Switch to "verify your email" screen instead of flipping to Sign In immediately
      setAwaitingVerification({ email: formData.email })
      toast.success('Account created. Check your email to verify, then sign in.')
    } catch (err) {
      console.error(err)
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  function handleInputChange(field: keyof typeof formData, value: string) {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (error) setError('')
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
    else toast.success('Password reset email sent!')
  }

  // NEW: resend verification handler
  async function resendVerification() {
    if (!awaitingVerification?.email) return
    try {
      setResending(true)
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: awaitingVerification.email,
        // optional redirect; if you have a custom site URL configured in Supabase Auth,
        // you can omit this. Otherwise, pass the AuthCallback route:
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) {
        toast.error(error.message)
      } else {
        toast.success('Verification email resent.')
      }
    } finally {
      setResending(false)
    }
  }

  // --- UI ---

  // After sign-up, show the waiting/verification screen
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
              <CardTitle className="text-center">Verify your email</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground text-center">
                We sent a verification link to <strong>{awaitingVerification.email}</strong>.
                Open it on the same device/browser to finish sign-in.
              </div>

              <div className="flex items-center justify-center gap-2">
                <Button onClick={resendVerification} disabled={resending} className="min-w-[180px]">
                  <Mail className="h-4 w-4 mr-2" />
                  {resending ? 'Resending…' : 'Resend verification'}
                </Button>
              </div>

              <div className="text-center text-xs text-muted-foreground">
                Wrong address? <Button
                  variant="link"
                  className="px-1"
                  onClick={() => { setAwaitingVerification(null); setIsLogin(false); }}
                >
                  Go back and edit
                </Button>
              </div>

              <div className="text-center text-xs text-muted-foreground">
                Already verified? <Button
                  variant="link"
                  className="px-1"
                  onClick={() => { setAwaitingVerification(null); setIsLogin(true); }}
                >
                  Sign in
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Default login / signup form
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
            <CardTitle className="text-center">{isLogin ? 'Sign In' : 'Create Account'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    placeholder="Enter your full name"
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  placeholder="Enter your email"
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => handleInputChange('password', e.target.value)}
                    placeholder="Enter your password"
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
                {loading ? 'Please wait…' : (isLogin ? 'Sign In' : 'Create Account')}
              </Button>
            </form>

            {isLogin && (
              <div className="mt-4 text-right">
                <Button variant="link" onClick={handleResetPassword}>
                  Forgot Password?
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
                {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
