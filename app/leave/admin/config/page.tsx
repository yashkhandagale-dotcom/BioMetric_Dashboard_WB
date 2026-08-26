'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ListChecks,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import LeavePageHeader from '@/components/leave/LeavePageHeader';

// Feedback item #3 — "Leave Configuration & Policy": HR-facing editor
// for what used to be hardcoded (lib/leavePolicy.ts's probation/notice
// knobs, and fn_check_planned_leave_notice's PL tiers) plus item #4's
// per-leave-type weekly alert thresholds. Same 'use client' + self-
// fetch pattern as the neighboring Organization admin page.
type PolicyConfig = {
  probationUnlockMonths: number;
  noticePeriodDefaultDays: number;
  reminderIntervalHours: number;
  finalReminderDay: number;
  manualReminderCooldownHours: number;
};
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

function initials(text: string) {
  return text
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export default function LeaveConfigPage() {
  const [config, setConfig] = useState<PolicyConfig | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeConfig[]>([]);
  // Snapshot of the last-saved (or last-fetched) state, used purely to
  // detect unsaved changes and to power Discard — never written to
  // directly outside of load/save.
  const [snapshot, setSnapshot] = useState<{ config: PolicyConfig; leaveTypes: LeaveTypeConfig[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Collapsed by default is opt-in per card (unset = expanded), so a
  // page with many leave types doesn't dump every field on screen at
  // once — collapse the ones you're not touching.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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
        setSnapshot({ config: body.config, leaveTypes: body.leaveTypes ?? [] });
      })
      .finally(() => setLoading(false));
  }, []);

  // Success banner clears itself — a permanent "Saved." banner just
  // becomes stale chrome the moment the person starts editing again.
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(null), 4000);
    return () => clearTimeout(t);
  }, [savedAt]);

  const isDirty = useMemo(() => {
    if (!snapshot || !config) return false;
    return JSON.stringify({ config, leaveTypes }) !== JSON.stringify({ config: snapshot.config, leaveTypes: snapshot.leaveTypes });
  }, [config, leaveTypes, snapshot]);

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

  function discardChanges() {
    if (!snapshot) return;
    setConfig(snapshot.config);
    setLeaveTypes(snapshot.leaveTypes);
    setError(null);
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
      setSnapshot({ config: body.config, leaveTypes: body.leaveTypes ?? [] });
      setSavedAt(Date.now());
    } catch {
      setError('Could not reach the server — check your connection and retry.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl space-y-6">
        <LeavePageHeader title="Leave Configuration" description="Loading…" />
        <div className="animate-pulse space-y-6">
          <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-4">
            <div className="h-4 w-32 rounded bg-[var(--border)]" />
            <div className="grid grid-cols-2 gap-4">
              <div className="h-16 rounded-lg bg-[var(--border)]/60" />
              <div className="h-16 rounded-lg bg-[var(--border)]/60" />
            </div>
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3">
              <div className="h-4 w-40 rounded bg-[var(--border)]" />
              <div className="h-16 rounded-lg bg-[var(--border)]/60" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6 pb-6">
      <LeavePageHeader
        title="Leave Configuration"
        description="Policy rules that used to be hardcoded — now editable here."
      />

      {error && (
        <div className="flex items-start gap-2 bg-red-50 dark:bg-red-500/15 border border-red-500/40 text-red-700 dark:text-red-300 text-sm font-medium rounded-xl px-4 py-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      {savedAt && !error && (
        <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 text-sm font-medium rounded-xl px-4 py-3">
          <CheckCircle2 size={16} className="shrink-0" />
          Saved.
        </div>
      )}

      {/* Global knobs */}
      <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <SlidersHorizontal size={15} className="text-[var(--accent)]" />
          Global Policy
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Probation unlock (months)</label>
            <input
              type="number"
              min={0}
              value={config?.probationUnlockMonths ?? 0}
              onChange={(e) => setConfig((c) => (c ? { ...c, probationUnlockMonths: Number(e.target.value) } : c))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
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
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
            />
            <p className="text-[var(--text-muted)] text-xs mt-1">Used when an employee's own notice_period_days isn't set.</p>
          </div>
        </div>
      </div>

      {/* Reminder scheduling — how often the unmarked-attendance /
         pending-approval escalation reminders fire (automated + manual),
         and the guaranteed month-end final nudge. */}
      <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <SlidersHorizontal size={15} className="text-[var(--accent)]" />
          Reminder Scheduling
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Automated reminder interval (hours)</label>
            <input
              type="number"
              min={1}
              value={config?.reminderIntervalHours ?? 48}
              onChange={(e) => setConfig((c) => (c ? { ...c, reminderIntervalHours: Number(e.target.value) } : c))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
            />
            <p className="text-[var(--text-muted)] text-xs mt-1">
              How often the daily sweep re-nudges an open item (unmarked day, pending half-day, pending regularisation). First reminder still fires immediately when the item first goes unmarked.
            </p>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Final reminder day of month</label>
            <input
              type="number"
              min={1}
              max={28}
              value={config?.finalReminderDay ?? 25}
              onChange={(e) => setConfig((c) => (c ? { ...c, finalReminderDay: Number(e.target.value) } : c))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
            />
            <p className="text-[var(--text-muted)] text-xs mt-1">
              For any leave/exception dated on or before this day, a final reminder is guaranteed on this day of that month — regardless of the interval above.
            </p>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Manual reminder cooldown (hours)</label>
            <input
              type="number"
              min={1}
              value={config?.manualReminderCooldownHours ?? 24}
              onChange={(e) => setConfig((c) => (c ? { ...c, manualReminderCooldownHours: Number(e.target.value) } : c))}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
            />
            <p className="text-[var(--text-muted)] text-xs mt-1">
              How long HR must wait after a reminder (automated or manual) before clicking "Remind" again on the same item.
            </p>
          </div>
        </div>
      </div>

      {/* Per leave-type config */}
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <ListChecks size={15} className="text-[var(--accent)]" />
          Leave Types
        </h2>
        {leaveTypes.map((t) => {
          const isCollapsed = !!collapsed[t.id];
          return (
            <div key={t.id} className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setCollapsed((prev) => ({ ...prev, [t.id]: !prev[t.id] }))}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--bg-surface)]/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs font-semibold">
                    {initials(t.code)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{t.displayName}</p>
                    {isCollapsed && (
                      <p className="text-[var(--text-muted)] text-xs mt-0.5 truncate">
                        {t.annualQuota}d/yr · {t.maxConsecutiveDays ? `max ${t.maxConsecutiveDays}d` : 'no max'} ·{' '}
                        {t.alertEnabled ? `alert @ ${t.weeklyThreshold}/wk` : 'alerts off'}
                      </p>
                    )}
                  </div>
                </div>
                <ChevronDown
                  size={16}
                  className={`shrink-0 text-[var(--text-muted)] transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                />
              </button>

              {!isCollapsed && (
                <div className="px-4 pb-4 space-y-3 border-t border-[var(--border)] pt-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">Annual quota (days)</label>
                      <input
                        type="number"
                        min={0}
                        value={t.annualQuota}
                        onChange={(e) => updateLeaveType(t.id, { annualQuota: Number(e.target.value) })}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
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
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
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
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
                      />
                    </div>
                  </div>

                  {t.minNoticeDaysTier && t.minNoticeDaysTier.length > 0 && (
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-2">Notice period tiers (leave length → notice required)</label>
                      <div className="flex flex-wrap gap-2">
                        {t.minNoticeDaysTier.map((tier, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5"
                          >
                            <span className="text-xs text-[var(--text-muted)]">Up to</span>
                            <input
                              type="number"
                              min={0}
                              value={tier.maxDays ?? ''}
                              placeholder="∞"
                              disabled={i === t.minNoticeDaysTier!.length - 1}
                              onChange={(e) => updateTier(t.id, i, { maxDays: e.target.value === '' ? null : Number(e.target.value) })}
                              className="w-12 bg-transparent text-sm text-[var(--text-primary)] text-center disabled:opacity-40 focus:outline-none"
                            />
                            <span className="text-xs text-[var(--text-muted)]">days</span>
                            <ArrowRight size={12} className="text-[var(--text-muted)] shrink-0" />
                            <input
                              type="number"
                              min={0}
                              value={tier.noticeDays}
                              onChange={(e) => updateTier(t.id, i, { noticeDays: Number(e.target.value) })}
                              className="w-12 bg-transparent text-sm text-[var(--text-primary)] text-center focus:outline-none"
                            />
                            <span className="text-xs text-[var(--text-muted)]">days notice</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-[var(--border)]">
                    <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <input
                        type="checkbox"
                        checked={t.alertEnabled}
                        onChange={(e) => updateLeaveType(t.id, { alertEnabled: e.target.checked })}
                        className="accent-[var(--accent)]"
                      />
                      Alert HR + manager if weekly requests reach
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={t.weeklyThreshold}
                      onChange={(e) => updateLeaveType(t.id, { weeklyThreshold: Number(e.target.value) })}
                      disabled={!t.alertEnabled}
                      className="w-16 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
                    />
                    <span className="text-xs text-[var(--text-muted)]">requests in a rolling 7 days</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sticky save bar — only takes up space once there's something to
         save, so the page isn't permanently reserving room for it, and
         you don't have to scroll back to the top to commit a change made
         at the bottom of a long leave-type list. */}
      {isDirty && (
        <div className="sticky bottom-4 z-40 flex items-center justify-between gap-3 bg-[var(--bg-surface)] border border-[var(--border)] shadow-lg rounded-xl px-4 py-3">
          <p className="text-xs text-[var(--text-muted)]">You have unsaved changes.</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={discardChanges}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 px-3 py-2 rounded-lg transition-colors"
            >
              <RotateCcw size={13} />
              Discard
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-50 text-white text-xs font-medium px-3.5 py-2 rounded-lg transition-colors"
            >
              <Save size={13} />
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}