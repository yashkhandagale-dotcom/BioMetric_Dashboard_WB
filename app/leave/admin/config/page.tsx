'use client';

import { useEffect, useState } from 'react';
import LeavePageHeader from '@/components/leave/LeavePageHeader';

// Feedback item #3 — "Leave Configuration & Policy": HR-facing editor
// for what used to be hardcoded (lib/leavePolicy.ts's probation/notice
// knobs, and fn_check_planned_leave_notice's PL tiers) plus item #4's
// per-leave-type weekly alert thresholds. Same 'use client' + self-
// fetch pattern as the neighboring Organization admin page.
type PolicyConfig = { probationUnlockMonths: number; noticePeriodDefaultDays: number };
type NoticeTier = { maxDays: number | null; noticeDays: number };
type LeaveTypeConfig = {
  id: string;
  code: string;
  displayName: string;
  annualQuota: number;
  maxConsecutiveDays: number | null;
  minNoticeDaysTier: NoticeTier[] | null;
  requiresCertificateAfterDays: number | null;
  weeklyThreshold: number;
  alertEnabled: boolean;
};

export default function LeaveConfigPage() {
  const [config, setConfig] = useState<PolicyConfig | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/leave/config')
      .then((res) => res.json())
      .then((body) => {
        if (body.error) {
          setError(body.error);
          return;
        }
        setConfig(body.config);
        setLeaveTypes(body.leaveTypes ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  function updateLeaveType(id: string, patch: Partial<LeaveTypeConfig>) {
    setLeaveTypes((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function updateTier(id: string, tierIndex: number, patch: Partial<NoticeTier>) {
    setLeaveTypes((prev) =>
      prev.map((t) => {
        if (t.id !== id || !t.minNoticeDaysTier) return t;
        const tiers = t.minNoticeDaysTier.map((tier, i) => (i === tierIndex ? { ...tier, ...patch } : tier));
        return { ...t, minNoticeDaysTier: tiers };
      })
    );
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/leave/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policyConfig: config,
          leaveTypeUpdates: leaveTypes.map((t) => ({
            id: t.id,
            annualQuota: t.annualQuota,
            maxConsecutiveDays: t.maxConsecutiveDays,
            minNoticeDaysTier: t.minNoticeDaysTier,
            requiresCertificateAfterDays: t.requiresCertificateAfterDays,
            weeklyThreshold: t.weeklyThreshold,
            alertEnabled: t.alertEnabled,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Could not save changes.');
        return;
      }
      setConfig(body.config);
      setLeaveTypes(body.leaveTypes ?? []);
      setSavedAt(Date.now());
    } catch {
      setError('Could not reach the server — check your connection and retry.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl">
        <LeavePageHeader title="Leave Configuration" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <LeavePageHeader
        title="Leave Configuration"
        description="Policy rules that used to be hardcoded — now editable here."
        actions={
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        }
      />

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}
      {savedAt && !error && (
        <div className="bg-emerald-900/20 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-sm rounded-xl px-4 py-3">
          Saved.
        </div>
      )}

      {/* Global knobs */}
      <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Global Policy</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Probation unlock (months)</label>
            <input
              type="number"
              min={0}
              value={config?.probationUnlockMonths ?? 0}
              onChange={(e) => setConfig((c) => (c ? { ...c, probationUnlockMonths: Number(e.target.value) } : c))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
            />
            <p className="text-[var(--text-muted)] text-xs mt-1">Employees within this many months of joining are auto-converted to LWP for planned leave.</p>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Default notice period (days)</label>
            <input
              type="number"
              min={0}
              value={config?.noticePeriodDefaultDays ?? 0}
              onChange={(e) => setConfig((c) => (c ? { ...c, noticePeriodDefaultDays: Number(e.target.value) } : c))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
            />
            <p className="text-[var(--text-muted)] text-xs mt-1">Used when an employee's own notice_period_days isn't set.</p>
          </div>
        </div>
      </div>

      {/* Per leave-type config */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Leave Types</h2>
        {leaveTypes.map((t) => (
          <div key={t.id} className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{t.displayName} <span className="text-[var(--text-muted)] font-normal">({t.code})</span></p>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Annual quota (days)</label>
                <input
                  type="number"
                  min={0}
                  value={t.annualQuota}
                  onChange={(e) => updateLeaveType(t.id, { annualQuota: Number(e.target.value) })}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Max consecutive days</label>
                <input
                  type="number"
                  min={0}
                  value={t.maxConsecutiveDays ?? ''}
                  placeholder="No limit"
                  onChange={(e) => updateLeaveType(t.id, { maxConsecutiveDays: e.target.value === '' ? null : Number(e.target.value) })}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Certificate required after (days)</label>
                <input
                  type="number"
                  min={0}
                  value={t.requiresCertificateAfterDays ?? ''}
                  placeholder="Never"
                  onChange={(e) => updateLeaveType(t.id, { requiresCertificateAfterDays: e.target.value === '' ? null : Number(e.target.value) })}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>
            </div>

            {t.minNoticeDaysTier && t.minNoticeDaysTier.length > 0 && (
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-2">Notice period tiers (leave length → notice required)</label>
                <div className="flex flex-wrap gap-3">
                  {t.minNoticeDaysTier.map((tier, i) => (
                    <div key={i} className="flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2 py-1.5">
                      <span className="text-xs text-[var(--text-muted)]">≤</span>
                      <input
                        type="number"
                        min={0}
                        value={tier.maxDays ?? ''}
                        placeholder="∞"
                        disabled={i === t.minNoticeDaysTier!.length - 1}
                        onChange={(e) => updateTier(t.id, i, { maxDays: e.target.value === '' ? null : Number(e.target.value) })}
                        className="w-14 bg-transparent text-sm text-[var(--text-primary)] text-center disabled:opacity-40"
                      />
                      <span className="text-xs text-[var(--text-muted)]">days →</span>
                      <input
                        type="number"
                        min={0}
                        value={tier.noticeDays}
                        onChange={(e) => updateTier(t.id, i, { noticeDays: Number(e.target.value) })}
                        className="w-14 bg-transparent text-sm text-[var(--text-primary)] text-center"
                      />
                      <span className="text-xs text-[var(--text-muted)]">days notice</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2 border-t border-[var(--border)]">
              <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={t.alertEnabled}
                  onChange={(e) => updateLeaveType(t.id, { alertEnabled: e.target.checked })}
                />
                Alert HR + manager if weekly requests reach
              </label>
              <input
                type="number"
                min={1}
                value={t.weeklyThreshold}
                onChange={(e) => updateLeaveType(t.id, { weeklyThreshold: Number(e.target.value) })}
                disabled={!t.alertEnabled}
                className="w-16 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] disabled:opacity-40"
              />
              <span className="text-xs text-[var(--text-muted)]">requests in a rolling 7 days</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
