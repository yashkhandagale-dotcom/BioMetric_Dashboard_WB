'use client';

import { useState } from 'react';

// One button, two modes, depending on whether this employee already has
// a Supabase Auth account linked:
//  - No login yet  -> "Create Login": HR types the initial password
//    directly (email_confirm: true, no invite email — see
//    .../create-login route's header comment). Replaces the old
//    bulk-CSV-only path for the routine one-at-a-time case.
//  - Has a login    -> "Reset Password": HR types a temporary password;
//    the employee is forced to change it on next login (see
//    .../reset-password route + must_change_password gate).
export default function EmployeeLoginButton({
  employeeId,
  employeeName,
  hasLogin,
}: {
  employeeId: string;
  employeeName: string;
  hasLogin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setPassword('');
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setSaving(true);
    try {
      const url = hasLogin
        ? `/api/leave/admin/employees/${employeeId}/reset-password`
        : `/api/leave/admin/employees/${employeeId}/create-login`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hasLogin ? { new_password: password } : { password }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      setSaving(false);
      if (!res.ok) {
        setError(data.error || `Failed (${res.status}).`);
        return;
      }
      setSuccess(data.message || 'Done.');
      setPassword('');
    } catch {
      setSaving(false);
      setError('Could not reach the server — check your connection and try again.');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--border)] rounded-lg px-2.5 py-1 transition-colors"
      >
        {hasLogin ? 'Reset Password' : 'Create Login'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={close}>
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-[var(--text-primary)] font-semibold text-sm">
                {hasLogin ? 'Reset Password' : 'Create Login'} — {employeeName}
              </h3>
              <p className="text-[var(--text-muted)] text-xs mt-1">
                {hasLogin
                  ? 'Sets a temporary password. They\u2019ll be asked to change it themselves the next time they log in.'
                  : 'Sets this employee\u2019s initial password. They can log in with it right away, and change it later from their own account.'}
              </p>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            {success ? (
              <div className="bg-emerald-900/30 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs rounded-lg px-3 py-2">
                {success}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    {hasLogin ? 'Temporary password' : 'Initial password'}
                  </label>
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] font-mono"
                    required
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button type="button" onClick={close} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm px-3 py-2">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {saving ? 'Saving…' : hasLogin ? 'Reset Password' : 'Create Login'}
                  </button>
                </div>
              </form>
            )}
            {success && (
              <div className="flex justify-end">
                <button type="button" onClick={close} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm px-3 py-2">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
