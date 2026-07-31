import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { Button } from '../ui';
import { useAuth } from '../../hooks/useAuth';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_BUTTON_WIDTH = 348; // matches the card's inner content width (420px card - 2x36px padding)

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; ux_mode: 'redirect'; login_uri: string }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

// Google POSTs the ID token here as a real top-level form submission (not a
// fetch) — nginx proxies /api/ to the API container, so this stays same-origin
// in every environment without hardcoding a host.
const GOOGLE_CALLBACK_URL = typeof window !== 'undefined' ? `${window.location.origin}/api/auth/google/callback` : '';

const GOOGLE_SIGNIN_ERROR_MESSAGES: Record<string, string> = {
  google_signin_failed: 'Google sign-in failed. Please try again.',
};

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleReady, setIsGoogleReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);

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

  // Surface a Google-callback failure after the full-page redirect lands
  // back on /login?error=... and clean the URL up so refreshing doesn't
  // re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('error');
    if (code) {
      setError(GOOGLE_SIGNIN_ERROR_MESSAGES[code] ?? 'Google sign-in failed. Please try again.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    let cancelled = false;
    const tryRender = () => {
      if (cancelled) return;
      if (window.google?.accounts?.id && googleButtonRef.current) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          ux_mode: 'redirect',
          login_uri: GOOGLE_CALLBACK_URL,
        });
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'continue_with',
          width: GOOGLE_BUTTON_WIDTH,
        });
        setIsGoogleReady(true);
      } else {
        setTimeout(tryRender, 100);
      }
    };
    tryRender();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f4f7fb] px-4 py-12 dark:bg-slate-950">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(rgba(0,46,92,0.12) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-navy-300/25 blur-[110px]" />
      <div className="pointer-events-none absolute -right-40 top-1/4 h-[480px] w-[480px] rounded-full bg-cyan-300/25 blur-[110px]" />
      <div className="pointer-events-none absolute bottom-[-15%] left-1/3 h-[420px] w-[420px] rounded-full bg-navy-200/20 blur-[110px]" />
      <div
        className="pointer-events-none absolute inset-0 dark:hidden"
        style={{ background: 'radial-gradient(ellipse at center, transparent 35%, #f4f7fb 85%)' }}
      />
      <div
        className="pointer-events-none absolute inset-0 hidden dark:block"
        style={{ background: 'radial-gradient(ellipse at center, transparent 35%, #020617 85%)' }}
      />

      <div className="relative w-full max-w-[420px]">
        <div className="flex justify-center">
          <img src="/images/si-ware-logo.png" alt="Si-Ware" className="h-12 w-auto max-w-[240px] object-contain" />
        </div>

        <div className="mt-7 flex items-center justify-center gap-3">
          <span className="h-px w-8 bg-navy-300" />
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-navy-700">Document Management System</p>
          <span className="h-px w-8 bg-navy-300" />
        </div>

        <p className="mx-auto mt-4 max-w-sm text-center text-[15px] leading-relaxed text-[#4b5b78]">
          Secure, compliant, and fully traceable
          <br />
          from document creation through final approval.
        </p>

        <div className="mt-8 rounded-[14px] border border-navy-100/70 bg-white/90 p-9 shadow-xl shadow-navy-900/[0.05] backdrop-blur-sm dark:border-white/10 dark:bg-slate-900/90">
          <div className="mb-7 text-center">
            <h2 className="font-serif text-[1.6rem] font-bold tracking-tight text-navy-900 dark:text-white">Sign in securely</h2>
            <p className="mt-1.5 text-sm text-[#718198] dark:text-slate-400">
              Authorized Si-Ware Employees only.
              <br />
              Please use your Corporate Account to continue.
            </p>
          </div>

          {GOOGLE_CLIENT_ID ? (
            <>
              <div ref={googleButtonRef} className="flex justify-center" />
              {!isGoogleReady && <div className="h-11 w-full animate-pulse rounded-[6px] bg-[#eef1f6] dark:bg-slate-800" />}
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" size="lg" className="w-full font-medium" disabled title="Google sign-in is not configured">
                Continue with Google
              </Button>
              <p className="mt-2 text-center text-xs text-[#a3b1c4]">Google sign-in is not configured yet.</p>
            </>
          )}

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-[#e5eaf1] dark:bg-white/10" />
            <span className="text-xs font-medium uppercase tracking-wide text-[#a3b1c4]">or</span>
            <span className="h-px flex-1 bg-[#e5eaf1] dark:bg-white/10" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                Email address
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@si-ware.com"
                  disabled={isSubmitting}
                  className="field-control h-11 w-full rounded-[6px] border-[#dbe2ec] pl-10 pr-3 text-sm placeholder-[#a3b1c4] transition-colors focus:border-navy-500 focus:ring-4 focus:ring-navy-500/10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={isSubmitting}
                  className="field-control h-11 w-full rounded-[6px] border-[#dbe2ec] pl-10 pr-11 text-sm placeholder-[#a3b1c4] transition-colors focus:border-navy-500 focus:ring-4 focus:ring-navy-500/10"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#94a3b8] transition-colors hover:text-[#34425b] dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-[6px] border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full font-medium" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <div className="mt-6 text-center text-xs text-[#8a99b3] dark:text-slate-500">
          <p className="font-medium">Operated by IT Team</p>
          <p className="mt-1">
            For assistance, please contact the IT Helpdesk.
            <br />
            <a href="mailto:ithelpdesk@si-ware.com" className="text-navy-600 hover:underline">
              ithelpdesk@si-ware.com
            </a>
          </p>
        </div>
        <p className="mt-3 text-center text-xs text-[#a3b1c4]">© {new Date().getFullYear()} Si-Ware Systems. All rights reserved.</p>
      </div>
    </div>
  );
}
