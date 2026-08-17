'use client';

import { useEffect, useState, useCallback } from 'react';

// Feedback items #5, #6, #7, #10, #12 — the employee-facing half of the
// WFH workflow, kept as one self-contained client component on
// /leave/me (parallel to MeNavbar's leave-apply drawer + LeaveHistoryTable's
// leave history, but WFH has its own table/status vocabulary so it's not
// worth forcing through those two components). Fetches its own data
// client-side (rather than being fed by the server page) since it also
// owns the apply/cancel actions and needs to re-fetch after each one —
// same trade-off LeaveHistoryTable's sibling MeNavbar makes with
// router.refresh(), just self-contained instead of split across a
// custom event.
type WfhRow = {
  id: string;
  start_date: string;
  end_date: string;
  is_half_day: boolean;
  half_day_session: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  rejection_comment: string | null;
  applied_on: string;
};

function formatDateRange(start: string, end: string) {
  return start === end ? start : `${start} → ${end}`;
}

const STATUS_STYLES: Record<WfhRow['status'], string> = {
  pending: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  approved: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-500/20 text-red-700 dark:text-red-300',
  cancelled: 'bg-[var(--bg-elevated)] text-[var(--text-muted)]',
};

export default function WfhPanel() {
  const [rows, setRows] = useState<WfhRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>('AM');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leave/wfh?scope=mine');
      const body = await res.json();
      setRows(body.requests ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Feedback item #7 — reuse the same reapply event LeaveHistoryTable
  // dispatches for leave (if a leave request was rejected the employee
  // might reapply as WFH, or vice versa here) — pre-fills this form's
  // dates/reason and opens it.
  useEffect(() => {
    function onReapply(e: Event) {
      const detail = (e as CustomEvent<{ startDate?: string; endDate?: string; isHalfDay?: boolean; halfDaySession?: 'AM' | 'PM'; reason?: string }>).detail;
      if (!detail) return;
      setStartDate(detail.startDate ?? '');
      setEndDate(detail.endDate ?? detail.startDate ?? '');
      setIsHalfDay(!!detail.isHalfDay);
      if (detail.halfDaySession) setHalfDaySession(detail.halfDaySession);
      setReason(detail.reason ?? '');
      setFormOpen(true);
    }
    window.addEventListener('wfh:reapply', onReapply as EventListener);
    return () => window.removeEventListener('wfh:reapply', onReapply as EventListener);
  }, []);

  async function handleApply() {
    if (!startDate || !reason.trim()) {
      setFormError('Start date and reason are required.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch('/api/leave/wfh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate: isHalfDay ? startDate : endDate || startDate,
          isHalfDay,
          halfDaySession: isHalfDay ? halfDaySession : undefined,
          reason,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.error || 'Could not submit WFH request.');
        return;
      }
      setFormOpen(false);
      setStartDate('');
      setEndDate('');
      setIsHalfDay(false);
      setReason('');
      await load();
    } catch {
      setFormError('Could not reach the server — check your connection and retry.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    setConfirmCancelId(null);
    await fetch(`/api/leave/wfh/${id}/cancel`, { method: 'POST' });
    await load();
  }

  function handleReapplyAsLeave(row: WfhRow) {
    window.dispatchEvent(
      new CustomEvent('leave:reapply', {
        detail: {
          startDate: row.start_date,
          endDate: row.end_date,
          isHalfDay: row.is_half_day,
          halfDaySession: row.half_day_session ?? undefined,
          reason: `Reapplying after WFH was rejected for ${formatDateRange(row.start_date, row.end_date)}.`,
        },
      })
    );
  }

  return (
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Work From Home</h2>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          + Apply for WFH
        </button>
      </div>

      {formOpen && (
        <div className="border border-[var(--border)] rounded-lg p-3 space-y-2 bg-[var(--bg-surface)]">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">End date</label>
              <input type="date" value={isHalfDay ? startDate : endDate} disabled={isHalfDay} onChange={(e) => setEndDate(e.target.value)} className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] disabled:opacity-50" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <input type="checkbox" checked={isHalfDay} onChange={(e) => setIsHalfDay(e.target.checked)} />
            Half day
          </label>
          {isHalfDay && (
            <select value={halfDaySession} onChange={(e) => setHalfDaySession(e.target.value as 'AM' | 'PM')} className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)]">
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          )}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Reason</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]" />
          </div>
          {formError && <p className="text-red-500 text-xs">{formError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setFormOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs px-3 py-1.5">Cancel</button>
            <button type="button" onClick={handleApply} disabled={submitting} className="bg-[var(--accent)] text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-[var(--text-muted)] text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm">No WFH requests yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <li key={row.id} className="py-2 flex items-start justify-between gap-3 text-sm">
              <div>
                <p className="text-[var(--text-primary)]">
                  {formatDateRange(row.start_date, row.end_date)}
                  {row.is_half_day && ` (${row.half_day_session ?? 'half day'})`}
                </p>
                <p className="text-[var(--text-muted)] text-xs">{row.reason}</p>
                {row.status === 'rejected' && row.rejection_comment && (
                  <p className="text-red-500 text-xs mt-0.5">Rejected: {row.rejection_comment}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${STATUS_STYLES[row.status]}`}>{row.status}</span>
                {(row.status === 'pending' || row.status === 'approved') && (
                  <button type="button" onClick={() => setConfirmCancelId(row.id)} className="text-red-600 dark:text-red-400 hover:underline text-xs">
                    {row.status === 'pending' ? 'Withdraw' : 'Cancel'}
                  </button>
                )}
                {row.status === 'rejected' && (
                  <button type="button" onClick={() => handleReapplyAsLeave(row)} className="text-[var(--accent)] hover:underline text-xs">
                    Apply for a leave type instead
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Feedback item #10 — confirmation popup before cancelling. */}
      {confirmCancelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmCancelId(null)}>
          <div className="w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Cancel this WFH request?</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">If it was already approved, the day will be removed from your attendance record.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmCancelId(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)]">Keep it</button>
              <button type="button" onClick={() => handleCancel(confirmCancelId)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white">Yes, cancel it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
