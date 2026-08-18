'use client';

import { useEffect, useState, useCallback } from 'react';

// Feedback items #5, #6, #7, #10, #12 — the employee-facing half of the
// WFH workflow, kept as one self-contained client component on
// /leave/me (parallel to LeaveHistoryTable's leave history, but WFH
// has its own table/status vocabulary so it's not worth forcing
// through that component). Fetches its own data client-side (rather
// than being fed by the server page) since it also owns the cancel
// action and needs to re-fetch after it.
//
// The "Apply for WFH" action itself now lives in LeaveShell's sidebar
// (WfhApplyDrawer, opened as a popup from anywhere in the app) —
// this panel only lists what's already been applied for and lets the
// employee withdraw/cancel it. See LeaveShell.tsx's header comment for
// why apply actions moved out of individual page cards and into the
// sidebar.
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

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
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
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

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

  // Refetch whenever the sidebar's WFH apply popup completes, so a
  // freshly submitted request shows up here without a full reload.
  useEffect(() => {
    function onApplied() {
      load();
    }
    window.addEventListener('wfh:applied', onApplied);
    return () => window.removeEventListener('wfh:applied', onApplied);
  }, [load]);

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

  const today = todayYMD();

  return (
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Work From Home</h2>
      </div>

      {loading ? (
        <p className="text-[var(--text-muted)] text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm">No WFH requests yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((row) => {
            // Same "already started" rule the leave cancel API enforces
            // server-side (see app/api/leave/requests/[id]/cancel/route.ts)
            // — an approved request whose start date has passed is done;
            // disable the button instead of letting it be clicked and
            // fail with a server error.
            const alreadyStarted = row.status === 'approved' && row.start_date <= today;
            const canCancel = row.status === 'pending' || (row.status === 'approved' && !alreadyStarted);
            return (
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
                    <button
                      type="button"
                      onClick={() => setConfirmCancelId(row.id)}
                      disabled={!canCancel}
                      title={alreadyStarted ? 'This WFH day has already passed — nothing to cancel.' : undefined}
                      className="text-red-600 dark:text-red-400 hover:underline text-xs disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                    >
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
            );
          })}
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
