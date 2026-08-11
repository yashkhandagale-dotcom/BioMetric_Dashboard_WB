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
// After sign-in, look up the employees row (employee record is now the
// one source of truth for role, for both apps) and send the person to
// their role's home route — same ROLE_HOME → homeRouteForRole mapping
// the old /leave/login used, just centralized in
// lib/leaveSupabase/getCurrentEmployee.ts now so this page and every
// layout guard's "wrong role, bounce home" redirect agree.
const ROLE_HOME: Record<string, string> = {
  hr: '/',
  hr_super_admin: '/',
  manager: '/leave/me',
  lead: '/leave/me',
  employee: '/leave/me',
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        .select('role')
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
      next = ROLE_HOME[employeeRow.role] || '/leave/me';
    }

    setLoading(false);
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">WB</span>
          </div>
          <div>
            <h1 className="text-[var(--text-primary)] font-semibold text-sm">WonderBiz Technologies</h1>
            <p className="text-[var(--text-muted)] text-xs">Attendance &amp; Leave Tracker</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-6 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
              placeholder="you@wonderbiz.com"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
