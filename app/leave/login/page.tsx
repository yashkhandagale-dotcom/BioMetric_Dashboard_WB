'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createLeaveClient } from '@/lib/leaveSupabase/client';

// Deliberately its own login, on the leave-tracker's own Supabase project.
// A dashboard HR login and a leave-tracker's employee/lead/manager/HR
// login are unrelated accounts, even if the same human uses both.
//
// Sprint A: this used to always send everyone to /leave/admin (the old
// "any authenticated user is HR super admin" model). Now it looks up the
// signed-in user's employees.role and redirects to that role's home route
// (see lib/leaveSupabase/getCurrentEmployee.ts:homeRouteForRole) — unless
// `?next=` was set (e.g. someone hit a deep link while logged out and got
// bounced here), in which case that takes priority, same as before.
const ROLE_HOME: Record<string, string> = {
  hr: '/leave/admin',
  hr_super_admin: '/leave/admin',
  manager: '/leave/approvals',
  lead: '/leave/team',
  employee: '/leave/me',
};

function LeaveLoginForm() {
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
    const supabase = createLeaveClient();
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
          <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">LT</span>
          </div>
          <div>
            <h1 className="text-[var(--text-primary)] font-semibold text-sm">Leave Tracker</h1>
            <p className="text-[var(--text-muted)] text-xs">WonderBiz Technologies</p>
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
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
              placeholder="hr@wonderbiz.com"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-[var(--text-muted)] text-xs text-center mt-4">
          Separate login from the attendance dashboard. New here? HR invites you from the employee record — check your email for the invite link to set a password.
        </p>
      </div>
    </div>
  );
}

export default function LeaveLoginPage() {
  return (
    <Suspense fallback={null}>
      <LeaveLoginForm />
    </Suspense>
  );
}