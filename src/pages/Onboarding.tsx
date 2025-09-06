// src/pages/Onboarding.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/db';
import { useAuth } from '../hooks/useAuth';
import { useOrg } from '../hooks/useOrg';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription } from '../components/ui/alert';
import toast from 'react-hot-toast';
import { Factory } from 'lucide-react';

export default function Onboarding() {
  const { user } = useAuth();
  const { myRole, loading: orgLoading } = useOrg();
  const navigate = useNavigate();

  const [company, setCompany] = useState('My Company');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>('');

  // If already a member, bounce to dashboard
  useEffect(() => {
    if (user && !orgLoading && myRole) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, orgLoading, myRole, navigate]);

  if (!user) {
    // Route is protected, but guard anyway
    return <div className="p-6 text-muted-foreground">Please sign in…</div>;
  }

  const createCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const name = company.trim();
    if (!name) {
      setErr('Company name is required');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('create_company_and_bootstrap', { p_name: name });
      if (error) throw error;

      // Refresh claims for RLS hooks
      await supabase.auth.refreshSession();

      const createdName = (Array.isArray(data) ? data[0]?.company_name : null) ?? name;
      toast.success(`Created "${createdName}" and set you as OWNER`);
      navigate('/dashboard', { replace: true });
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to create company';
      setErr(msg);

      // If server says you already belong, give OrgProvider a moment then leave
      setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 800);
    } finally {
      setLoading(false);
    }
  };

  const switchAccount = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      navigate('/auth', { replace: true });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <Card>
          <CardHeader className="flex items-center gap-2">
            <Factory className="h-6 w-6" />
            <CardTitle>Set up your company</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createCompany} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="company">Company name</Label>
                <Input
                  id="company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Acme Ltd"
                />
              </div>

              {err && (
                <Alert variant="destructive">
                  <AlertDescription>{err}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Creating…' : 'Create & become OWNER'}
              </Button>

              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">
                  If you already belong to a company, you’ll be redirected automatically.
                </p>
                <Button variant="link" type="button" onClick={switchAccount}>
                  Use a different account
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
