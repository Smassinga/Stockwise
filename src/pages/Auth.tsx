import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Package, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/db'; // ⬅️ added

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    company: '', // used to bootstrap a company after sign-up
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const { login, register, requestPasswordReset } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        // ---- SIGN IN ----
        const res = await login(formData.email, formData.password);
        if (!res.success) {
          setError(res.error || 'Login failed');
          return;
        }
        // If user has no membership, your App routing (EnsureCompany) will redirect to /onboarding
        navigate('/dashboard');
        return;
      }

      // ---- SIGN UP ----
      // Only save name in user_metadata; roles/membership handled via company_members
      const reg = await register(formData.name, formData.email, formData.password);
      if (!reg.success) {
        setError(reg.error || 'Registration failed');
        return;
      }

      // Try immediate sign-in (if email confirmations disabled)
      const trySignIn = await login(formData.email, formData.password);

      if (trySignIn.success) {
        // Bootstrap: create company + make this user OWNER
        const companyName = (formData.company || 'My Company').trim();
        const { data: boot, error: bootErr } = await supabase.rpc(
          'create_company_and_bootstrap',
          { p_name: companyName }
        );

        if (bootErr) {
          // If already a member you'll get a friendly error; surface message to help testing
          toast.error(bootErr.message);
        } else {
          await supabase.auth.refreshSession();
          toast.success(
            `Created ${boot?.[0]?.company_name ?? companyName} and set you as OWNER`
          );
        }

        navigate('/dashboard');
        return;
      }

      // Otherwise, ask the user to verify and then sign in
      toast.success('Account created. Check your email to verify, then sign in.');
      setIsLogin(true);
    } catch (err) {
      console.error(err);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: keyof typeof formData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (error) setError('');
  };

  const handleResetPassword = async () => {
    if (!formData.email) {
      setError('Enter your email above first');
      return;
    }
    setLoading(true);
    const res = await requestPasswordReset(formData.email);
    setLoading(false);
    if (!res.success) setError(res.error || 'Failed to request password reset');
    else toast.success('Password reset email sent!');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <Package className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-2xl font-bold">StockWise</span>
          </div>
          <p className="text-muted-foreground">Advanced Inventory Management System</p>
        </div>

        {/* Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-center">{isLogin ? 'Sign In' : 'Create Account'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <>
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

                  <div className="space-y-2">
                    <Label htmlFor="company">Company (optional)</Label>
                    <Input
                      id="company"
                      type="text"
                      value={formData.company}
                      onChange={(e) => handleInputChange('company', e.target.value)}
                      placeholder="Your company name"
                    />
                  </div>
                </>
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
                {loading ? 'Please wait...' : (isLogin ? 'Sign In' : 'Create Account')}
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
                  setIsLogin(!isLogin);
                  setError('');
                  setFormData({ name: '', email: '', password: '', company: '' });
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
  );
}
