'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// The ONE login page for the whole app (single-login pivot — see
// middleware.ts's header comment and PROGRESS.md point 5). Used to be
// two separate logins (this page, HR-only, plus a second one at
// /leave/login with its own role-aware redirect) even though both
// already authenticated against the same Supabase auth pool — see
// lib/supabase/client.ts's comment for why that was, and why it's fixed
// now. /leave/login still exists as a redirect here for old links (see
// that file), so bookmarks/emails keep working.
//
// Google OAuth pivot (task sections 1–5): "Continue with Google" is now
// the primary path. It goes through Supabase's own OAuth flow, lands on
// app/api/auth/callback/route.ts (server-side — domain/admin-email
// checks, employee lookup-by-email, auth_user_id linking, all happen
// there, never in this client component), and that route decides where
// to send the person next (onboarding / forced password change / role
// home). Email+password stays available underneath as a secondary path
// — same ROLE_HOME → homeRouteForRole mapping the old /leave/login used,
// centralized in lib/leaveSupabase/getCurrentEmployee.ts.
const ROLE_HOME: Record<string, string> = {
  hr: '/',
  hr_super_admin: '/',
  manager: '/leave/me',
  lead: '/leave/me',
  employee: '/leave/me',
};

// Keep in sync with the error codes app/api/auth/callback/route.ts
// redirects back here with (?error=...).
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_missing_code: 'Google sign-in did not complete. Please try again.',
  oauth_exchange_failed: 'Google sign-in failed. Please try again.',
  oauth_no_email: 'Your Google account has no email address we can use to sign you in.',
  oauth_lookup_failed: 'Something went wrong looking up your account. Please try again.',
  no_employee_record:
    "We don't have an employee record for this email yet. Please contact HR to get set up, then try again.",
  unauthorized_email: 'This email is not authorized to sign in to WonderBiz. Use your @wonderbiz.in account, or contact HR.',
  already_linked_elsewhere:
    'This email is already linked to a different account. Contact HR to sort this out before signing in with Google.',
  link_failed: 'Signed in with Google, but linking your account failed. Please contact HR.',
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    (() => {
      const code = searchParams.get('error');
      return code ? OAUTH_ERROR_MESSAGES[code] || 'Sign-in failed. Please try again.' : null;
    })()
  );
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  async function handleGoogleSignIn() {
    setError(null);
    setGoogleLoading(true);
    const supabase = createClient();
    const next = searchParams.get('next');
    const redirectTo = `${window.location.origin}/api/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) {
      setGoogleLoading(false);
      setError(error.message);
    }
    // On success the browser navigates away to Google, so there is
    // nothing further to do here — app/api/auth/callback/route.ts takes
    // it from there once Google redirects back.
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }

    let next = searchParams.get('next');
    if (!next) {
      const { data: employeeRow } = await supabase
        .from('employees')
        .select('role, profile_confirmed_at, must_change_password')
        .eq('auth_user_id', signInData.user.id)
        .maybeSingle();

      if (!employeeRow) {
        setLoading(false);
        setError(
          "This account isn't linked to an employee record yet. Ask HR to link it, then try again."
        );
        await supabase.auth.signOut();
        return;
      }
      // An employee row already exists, so this is a normal login.
      // The acknowledgement/onboarding flow is only for people who do
      // NOT yet have an employees row. Keep the explicit password-change
      // requirement for password accounts, but never send an existing
      // employee through Google-style profile acknowledgement.
      next = employeeRow.must_change_password
        ? '/leave/change-password'
        : ROLE_HOME[employeeRow.role] || '/leave/me';
    }

    // Best-effort — surfaced in the Admin panel's "Last login" column.
    // Never blocks sign-in if it fails.
    await supabase
      .from('employees')
      .update({ last_login_at: new Date().toISOString() })
      .eq('auth_user_id', signInData.user.id);

    setLoading(false);
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] flex">
      {/* ── Left: branding ────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700 text-white flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/15 backdrop-blur rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-bold">WB</span>
          </div>
          <span className="font-semibold tracking-tight">WonderBiz Technologies</span>
        </div>
        <div className="space-y-3 max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">Attendance &amp; Leave, in one place.</h1>
          <p className="text-blue-100 text-sm leading-relaxed">
            Sign in to track attendance, apply for leave, and manage your team — all with the account your
            organization already gave you.
          </p>
        </div>
        <p className="text-blue-200/70 text-xs">© {new Date().getFullYear()} WonderBiz Technologies</p>
      </div>

      {/* ── Right: authentication ─────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8 lg:hidden justify-center">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">WB</span>
            </div>
            <div>
              <h1 className="text-[var(--text-primary)] font-semibold text-sm">WonderBiz Technologies</h1>
              <p className="text-[var(--text-muted)] text-xs">Attendance &amp; Leave Tracker</p>
            </div>
          </div>

          <div className="mb-6 hidden lg:block">
            <h2 className="text-xl font-semibold">Sign in</h2>
            <p className="text-[var(--text-muted)] text-xs mt-1">Use your WonderBiz Google account.</p>
          </div>

          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 sm:p-8 space-y-5 shadow-xl">
            {error && (
              <div className="bg-red-50 dark:bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-300 text-xs font-medium rounded-xl px-3.5 py-2.5 leading-relaxed">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 text-sm font-semibold py-3 rounded-xl border border-slate-200 shadow-sm hover:shadow transition-all duration-150"
            >
              <GoogleLogo />
              {googleLoading ? 'Redirecting…' : 'Continue with Google'}
            </button>
            <p className="text-[var(--text-muted)] text-[11px] text-center leading-relaxed">
              Use your <span className="font-medium text-[var(--text-primary)]">@wonderbiz.in</span> account. New here? Google sign-in works once HR has added you.
            </p>

            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-[var(--text-muted)] text-xs uppercase tracking-wider font-medium">or</span>
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>

            {!showPasswordForm ? (
              <button
                type="button"
                onClick={() => setShowPasswordForm(true)}
                className="w-full text-[var(--text-primary)] text-sm font-medium py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/50 hover:bg-[var(--bg-elevated)] hover:border-[var(--accent)]/50 transition-colors"
              >
                Sign in with email &amp; password
              </button>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Email address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] transition-all"
                    placeholder="you@wonderbiz.in"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] transition-all"
                    placeholder="••••••••"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 text-white text-sm font-semibold py-3 rounded-xl shadow-md transition-all duration-150"
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
                <p className="text-[var(--text-muted)] text-[11px] text-center">
                  Forgot your password? Contact HR to have it reset.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
