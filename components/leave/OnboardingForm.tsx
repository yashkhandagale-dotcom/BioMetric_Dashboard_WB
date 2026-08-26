'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function OnboardingForm({
  next,
  fullName,
  email,
  employeeCode,
  role,
  department,
  office,
  dateOfJoining,
  jobTitle,
  avatarUrl,
  initialPhone,
}: {
  next?: string;
  fullName: string;
  email: string;
  employeeCode: string;
  role: string;
  department: string;
  office: string;
  dateOfJoining: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  initialPhone: string;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialPhone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/leave/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setSaving(false);
        setError(data.error || `Could not save (${res.status}).`);
        return;
      }
      router.replace(next || '/leave/me');
      router.refresh();
    } catch {
      setSaving(false);
      setError('Could not reach the server — check your connection and try again.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-5 space-y-4">
      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover border border-[var(--border)]" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] flex items-center justify-center text-sm font-semibold text-[var(--text-muted)]">
            {fullName?.[0]?.toUpperCase() ?? '?'}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{fullName}</p>
          <p className="text-[var(--text-muted)] text-xs truncate">{email}</p>
        </div>
      </div>

      {/* Read-only, HR-controlled — see this file's page.tsx header comment. */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <ReadOnlyField label="Employee ID" value={employeeCode} />
        <ReadOnlyField label="Role" value={role.replace('_', ' ')} capitalize />
        <ReadOnlyField label="Department" value={department} />
        <ReadOnlyField label="Office" value={office} />
        <ReadOnlyField label="Date of joining" value={dateOfJoining || '—'} />
        <ReadOnlyField label="Job title" value={jobTitle || '—'} />
      </div>

      {/* The one employee-editable field for now. */}
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1.5">Phone (optional)</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Your contact number"
          className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
      >
        {saving ? 'Saving…' : 'Confirm and continue'}
      </button>
    </form>
  );
}

function ReadOnlyField({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-[var(--text-muted)] mb-0.5">{label}</p>
      <p className={`text-[var(--text-primary)] font-medium ${capitalize ? 'capitalize' : ''}`}>{value}</p>
    </div>
  );
}
