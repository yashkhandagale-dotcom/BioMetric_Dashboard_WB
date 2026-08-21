'use client';

import { useEffect, useState } from 'react';

type EmployeeOption = { id: string; full_name: string; employee_code: string; email: string };

// The routine replacement for CSV bulk import (see page.tsx's header
// comment) — pick one employee who doesn't have a login yet, set their
// password, done. Loads via /api/leave/employees and filters client-side
// to auth_user_id == null since that endpoint doesn't currently expose a
// server-side filter for it.
export default function CreateLoginForm() {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/leave/employees?without_login=1');
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) {
          setLoadError(data.error || `Could not load employees (${res.status}).`);
          return;
        }
        setEmployees(data.employees ?? []);
      } catch {
        setLoadError('Could not reach the server to load employees.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [success]);

  

  const filtered = employees.filter((e) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return e.full_name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q) || (e.email ?? '').toLowerCase().includes(q);
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedId) {
      setError('Pick an employee first.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/leave/admin/employees/${selectedId}/create-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      setSubmitting(false);
      if (!res.ok) {
        setError(data.error || `Failed (${res.status}).`);
        return;
      }
      setSuccess(data.message || 'Login created.');
      setSelectedId('');
      setPassword('');
    } catch {
      setSubmitting(false);
      setError('Could not reach the server — check your connection and try again.');
    }
  }

  return (
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-4 max-w-lg">
      {loadError && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">{loadError}</div>
      )}
      {success && (
        <div className="bg-emerald-900/30 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs rounded-lg px-3 py-2">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Employee (without a login yet)</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, code, or email…"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] mb-2"
          />
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            size={6}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            {loading && <option disabled>Loading…</option>}
            {!loading && filtered.length === 0 && <option disabled>No matching employees without a login.</option>}
            {filtered.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} · {e.employee_code} {e.email ? `· ${e.email}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Initial password</label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] font-mono"
          />
          <p className="text-[var(--text-muted)] text-[11px] mt-1">
            They can log in with this right away, and change it themselves afterward.
          </p>
        </div>
        <button
          type="submit"
          disabled={submitting || !selectedId}
          className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          {submitting ? 'Creating…' : 'Create Login'}
        </button>
      </form>
    </div>
  );
}
