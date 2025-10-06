import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useI18n } from '../lib/i18n'
import toast from 'react-hot-toast'

export default function Profile() {
  const { user, requestPasswordReset } = useAuth()
  const { t } = useI18n()
  const [displayName, setDisplayName] = useState(user?.name || '')
  const [phone, setPhone] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)

  // Load user profile data
  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return
      
      try {
        // Get additional user metadata from Supabase
        const { data: { user: userData }, error } = await supabase.auth.getUser()
        if (error) throw error
        
        if (userData) {
          setDisplayName(userData.user_metadata?.name || user.name || '')
          setPhone(userData.user_metadata?.phone || '')
        }
      } catch (error) {
        console.error('Error loading profile:', error)
      }
    }
    
    loadProfile()
  }, [user])

  const handleUpdateProfile = async () => {
    if (!user) return
    
    setLoading(true)
    try {
      // Update user metadata including phone number
      const { error } = await supabase.auth.updateUser({
        data: { 
          name: displayName,
          phone: phone
        }
      })
      
      if (error) throw error
      
      toast.success(t('profile.updated'))
    } catch (error: any) {
      console.error('Profile update error:', error)
      toast.error(error.message || t('profile.updateFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async () => {
    if (!user?.email) return
    
    if (newPassword !== confirmPassword) {
      toast.error(t('auth.passwordsDontMatch'))
      return
    }
    
    if (newPassword.length < 6) {
      toast.error(t('auth.passwordTooShort'))
      return
    }
    
    setPasswordLoading(true)
    try {
      // For Supabase, we need to use the reset password flow for existing users
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/auth`
      })
      
      if (error) throw error
      
      toast.success(t('profile.passwordResetEmailSent'))
      // Clear form
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error: any) {
      console.error('Password change error:', error)
      toast.error(error.message || t('profile.passwordChangeFailed'))
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!user?.email) return
    
    try {
      const { success, error } = await requestPasswordReset(user.email)
      
      if (success) {
        toast.success(t('profile.passwordResetEmailSent'))
      } else {
        throw new Error(error)
      }
    } catch (error: any) {
      console.error('Password reset error:', error)
      toast.error(error.message || t('profile.passwordResetFailed'))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('profile.title')}</h1>
        <p className="text-muted-foreground">{t('profile.subtitle')}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Profile Information */}
        <Card>
          <CardHeader>
            <CardTitle>{t('profile.information')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.field.email')}</Label>
              <Input
                id="email"
                value={user?.email || ''}
                disabled
              />
              <p className="text-xs text-muted-foreground">{t('profile.emailHelp')}</p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="displayName">{t('profile.displayName')}</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="phone">{t('profile.phone')}</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('profile.phonePlaceholder')}
              />
            </div>
            
            <Button 
              onClick={handleUpdateProfile} 
              disabled={loading}
              className="w-full"
            >
              {loading ? t('actions.saving') : t('actions.save')}
            </Button>
          </CardContent>
        </Card>

        {/* Password Management */}
        <Card>
          <CardHeader>
            <CardTitle>{t('profile.password')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">{t('profile.currentPassword')}</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="newPassword">{t('profile.newPassword')}</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('profile.confirmPassword')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            
            <Button 
              onClick={handleChangePassword} 
              disabled={passwordLoading}
              className="w-full"
            >
              {passwordLoading ? t('actions.updating') : t('profile.changePassword')}
            </Button>
            
            <div className="pt-4">
              <Button 
                variant="outline" 
                onClick={handleResetPassword}
                className="w-full"
              >
                {t('profile.resetPassword')}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('profile.resetPasswordHelp')}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}