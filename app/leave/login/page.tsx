'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createLeaveClient } from '@/lib/leaveSupabase/client';

// Deliberately its own login, on the leave-tracker's own Supabase project.
// A dashboard HR login and a leave-tracker super-admin login are unrelated
// accounts, even if the same human uses both.
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    const next = searchParams.get('next') || '/leave/admin';
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">LT</span>
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm">Leave Tracker</h1>
            <p className="text-slate-500 text-xs">WonderBiz Technologies · HR Super Admin</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-slate-800/40 border border-slate-700 rounded-xl p-6 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              placeholder="hr@wonderbiz.com"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
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
        <p className="text-slate-600 text-xs text-center mt-4">
          Separate login from the attendance dashboard. Accounts are created by an admin in the leave-tracker&apos;s Supabase dashboard.
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