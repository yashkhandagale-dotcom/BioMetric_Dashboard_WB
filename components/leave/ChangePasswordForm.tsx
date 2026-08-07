'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/leave/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setError(data.error || `Could not change your password (${res.status}).`);
        setLoading(false);
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        // '/' resolves everyone correctly on next load: HR lands on the
        // Dashboard directly, and app/leave/layout.tsx's own guards
        // bounce anyone else onward to their real home route — no need
        // to duplicate that role→route mapping here.
        router.replace('/');
        router.refresh();
      }, 900);
    } catch {
      setLoading(false);
      setError('Could not reach the server — check your connection and try again.');
    }
  }

  if (success) {
    return (
      <div className="bg-emerald-900/30 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-sm rounded-xl px-4 py-3 text-center">
        Password changed. Redirecting…
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-5 space-y-4">
      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1.5">
          {forced ? 'Temporary password (from HR)' : 'Current password'}
        </label>
        <input
          type="password"
          required
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
          placeholder="••••••••"
        />
      </div>
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1.5">New password</label>
        <input
          type="password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
          placeholder="At least 6 characters"
        />
      </div>
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1.5">Confirm new password</label>
        <input
          type="password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
          placeholder="••••••••"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
      >
        {loading ? 'Changing…' : 'Change Password'}
      </button>
    </form>
  );
}
