'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    const next = searchParams.get('next') || '/';
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">WB</span>
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm">Attendance Dashboard</h1>
            <p className="text-slate-500 text-xs">WonderBiz Technologies · HR Login</p>
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
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
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
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
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
        <p className="text-slate-600 text-xs text-center mt-4">
          Accounts are created by an admin in the Supabase dashboard — there&apos;s no self-signup.
        </p>
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
