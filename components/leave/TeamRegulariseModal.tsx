'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CalendarCheck, Check, CheckSquare, Sparkles, Square, Users, X } from 'lucide-react';
import type { RosterRow } from './TeamTabs';

const QUICK_REASONS = [
  'Early exit approved for team all-hands',
  'Client site visit / offsite meeting',
  'Severe weather early departure',
  'Festival / Holiday team early exit',
  'Team building activity',
];

export default function TeamRegulariseModal({
  reports,
  isOpen,
  onClose,
}: {
  reports: RosterRow[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const todayYMD = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(todayYMD);
  const [reason, setReason] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>(() => reports.map((r) => r.id));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  if (!isOpen) return null;

  const allSelected = selectedIds.length === reports.length && reports.length > 0;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(reports.map((r) => r.id));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please provide a reason or note for this regularisation.');
      return;
    }
    if (selectedIds.length === 0) {
      setError('Please select at least one team member.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/leave/regularisations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeIds: selectedIds,
          date,
          reason: reason.trim(),
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Failed to regularise team.');
        return;
      }

      setSuccessCount(selectedIds.length);
      setTimeout(() => {
        router.refresh();
        onClose();
      }, 1400);
    } catch {
      setError('Could not reach the server. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg rounded-3xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{
          background: 'linear-gradient(170deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg-surface)]/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[var(--accent)]/20 to-[var(--accent)]/5 border border-[var(--accent)]/30 text-[var(--accent)] flex items-center justify-center shadow-sm">
              <CalendarCheck size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--text-primary)]">Regularise Team Day</h2>
              <p className="text-xs text-[var(--text-muted)]">Annotate early exit or special day for your whole team</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        {successCount !== null ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-500 border border-emerald-500/40 flex items-center justify-center mx-auto shadow-md">
              <Check size={24} />
            </div>
            <p className="text-base font-bold text-[var(--text-primary)]">
              Successfully Regularised!
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {successCount} team member{successCount !== 1 ? 's' : ''} have been marked as regularised for {date}.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto scroll-thin flex-1">
            {error && (
              <div className="flex items-start gap-2 bg-red-50 dark:bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-300 text-xs font-medium rounded-xl p-3">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Date Picker */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                Date to Regularise
              </label>
              <input
                type="date"
                required
                value={date}
                max={todayYMD}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-primary)] font-medium focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] transition-all"
              />
            </div>

            {/* Reason */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                Reason / Note
              </label>
              <textarea
                required
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why did the team leave early or have modified hours? (e.g. approved all-hands)"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] transition-all"
              />

              {/* Quick suggestions */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {QUICK_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className="text-[11px] font-medium rounded-lg px-2.5 py-1 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/40 transition-colors"
                  >
                    + {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Team Members Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Team Members ({selectedIds.length}/{reports.length})
                </label>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                >
                  {allSelected ? (
                    <>
                      <CheckSquare size={13} /> Deselect All
                    </>
                  ) : (
                    <>
                      <Square size={13} /> Select All
                    </>
                  )}
                </button>
              </div>

              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-2 max-h-40 overflow-y-auto scroll-thin divide-y divide-[var(--border-subtle)]">
                {reports.map((emp) => {
                  const isChecked = selectedIds.includes(emp.id);
                  return (
                    <label
                      key={emp.id}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOne(emp.id)}
                        className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]/30"
                      />
                      <span className="text-xs font-semibold text-[var(--text-primary)] truncate flex-1">
                        {emp.full_name}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)] shrink-0">
                        {emp.employee_code} · {emp.department}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || selectedIds.length === 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] hover:opacity-95 text-white text-xs font-bold shadow-md shadow-[var(--accent)]/25 disabled:opacity-50 transition-all"
              >
                <Sparkles size={14} />
                {loading ? 'Regularising…' : `Regularise ${selectedIds.length} Members`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
