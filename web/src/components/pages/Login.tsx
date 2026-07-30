import { useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, Lock, Mail } from 'lucide-react';
import { Button } from '../ui';
import { useAuth } from '../../hooks/useAuth';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-primary px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <img src="/images/si-ware-logo-dark.png" alt="Si-Ware" className="h-12 w-auto max-w-[220px] object-contain" />
        </div>

        <div className="rounded-[8px] border border-white/10 bg-white p-8 shadow-2xl dark:border-white/10 dark:bg-slate-900">
          <div className="mb-6 text-center">
            <h1 className="font-serif text-2xl font-bold tracking-tight text-[#26334d] dark:text-white">Sign in to DMS</h1>
            <p className="mt-1.5 text-sm text-[#718198] dark:text-slate-400">Enterprise Document Management System</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="login-email" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@si-ware.com"
                  disabled={isSubmitting}
                  className="field-control h-11 w-full rounded-[4px] border border-[#dbe2ec] bg-white pl-10 pr-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="login-password" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={isSubmitting}
                  className="field-control h-11 w-full rounded-[4px] border border-[#dbe2ec] bg-white pl-10 pr-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-[4px] border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Sign in
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-white/70">
          Contact your System Admin if you don't have an account yet.
        </p>
      </div>
    </div>
  );
}
