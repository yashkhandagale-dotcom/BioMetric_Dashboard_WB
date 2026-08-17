'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '../ConfirmDialog';
import type { ApplyLeaveInitialValues } from './ApplyLeaveForm';

export type LeaveHistoryRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  leaveTypeCode: string;
  leaveTypeLabel: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  halfDaySession: string | null;
  totalDays: number;
  status: string;
  isLwpOverride: boolean;
  appliedOn: string;
  recordedBy: string;
};

function formatDateRange(start: string, end: string) {
  return start === end ? start : `${start} → ${end}`;
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  approved: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  auto_lwp: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-500/20 text-red-700 dark:text-red-300',
  cancelled: 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]',
};

function statusLabel(status: string): string {
  if (status === 'auto_lwp') return 'Approved (LWP)';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// D3-2: columns are exactly employee, type, dates, days, half-day flag,
// LWP-override, applied-on, recorded-by — the list from the Sprint
// Tracker's Acceptance Criteria for this file, nothing added.
//
// showActions (feedback items #7, #10, #12) — opt-in Actions column, on
// by default (only /leave/me passes it; /leave/team stays read-only per
// its own header comment, so it omits the prop and keeps the old
// behavior unchanged). "Cancel/Withdraw" covers a still-pending OR an
// already-approved request (the API distinguishes the two — a pending
// row is simply marked cancelled, an approved one also credits the
// balance back). "Apply for another leave type" only shows on a
// rejected row and dispatches a `leave:reapply` event MeNavbar listens
// for, prefilling the Apply drawer with the same dates/reason.
export default function LeaveHistoryTable({ rows, showActions = false }: { rows: LeaveHistoryRow[]; showActions?: boolean }) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  async function handleConfirmCancel(id: string) {
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/leave/requests/${id}/cancel`, { method: 'POST' });
      const text = await res.text();
      const body = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setRowError({ id, message: body.error || 'Could not cancel this request.' });
        return;
      }
      router.refresh();
    } catch {
      setRowError({ id, message: 'Could not reach the server — check your connection and retry.' });
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  }

  function handleReapply(row: LeaveHistoryRow) {
    const detail: ApplyLeaveInitialValues = {
      startDate: row.startDate,
      endDate: row.endDate,
      isHalfDay: row.isHalfDay,
      halfDaySession: (row.halfDaySession as 'AM' | 'PM' | null) ?? undefined,
      reason: `Reapplying after ${row.leaveTypeLabel} was rejected for ${formatDateRange(row.startDate, row.endDate)}.`,
    };
    window.dispatchEvent(new CustomEvent('leave:reapply', { detail }));
  }

  if (rows.length === 0) {
    return (
      <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl px-4 py-10 text-center text-[var(--text-muted)] text-sm">
        No leave records match the current filters.
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--text-muted)] text-xs border-b border-[var(--border)]">
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Dates</th>
            <th className="px-4 py-3 text-right">Days</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Half-day</th>
            <th className="px-4 py-3">LWP override</th>
            <th className="px-4 py-3">Applied On</th>
            <th className="px-4 py-3">Recorded By</th>
            {showActions && <th className="px-4 py-3">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
              <td className="px-4 py-2.5">
                <p className="text-[var(--text-primary)]">{r.employeeName}</p>
                <p className="text-[var(--text-muted)] text-xs">
                  {r.employeeCode} · {r.department} · {r.office}
                </p>
              </td>
              <td className="px-4 py-2.5 text-[var(--text-muted)]">{r.leaveTypeLabel}</td>
              <td className="px-4 py-2.5 text-[var(--text-muted)]">{formatDateRange(r.startDate, r.endDate)}</td>
              <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">{r.totalDays.toFixed(2)}</td>
              <td className="px-4 py-2.5">
                <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${STATUS_STYLE[r.status] ?? 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]'}`}>
                  {statusLabel(r.status)}
                </span>
              </td>
              <td className="px-4 py-2.5 text-[var(--text-muted)]">
                {r.isHalfDay ? (r.halfDaySession ?? 'Yes') : '—'}
              </td>
              <td className="px-4 py-2.5">
                {r.isLwpOverride ? (
                  <span className="text-amber-400 text-xs">Yes</span>
                ) : (
                  <span className="text-[var(--text-muted)] text-xs">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-[var(--text-muted)]">{new Date(r.appliedOn).toLocaleDateString()}</td>
              <td className="px-4 py-2.5 text-[var(--text-muted)]">{r.recordedBy}</td>
              {showActions && (
                <td className="px-4 py-2.5">
                  <div className="flex flex-col gap-1 items-start">
                    {(r.status === 'pending' || r.status === 'approved' || r.status === 'auto_lwp') && (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(r.id)}
                        disabled={busyId === r.id}
                        className="text-red-600 dark:text-red-400 hover:underline text-xs font-medium disabled:opacity-50"
                      >
                        {r.status === 'pending' ? 'Withdraw' : 'Cancel'}
                      </button>
                    )}
                    {r.status === 'rejected' && (
                      <button
                        type="button"
                        onClick={() => handleReapply(r)}
                        className="text-[var(--accent)] hover:underline text-xs font-medium"
                      >
                        Apply for another leave type
                      </button>
                    )}
                    {rowError?.id === r.id && <p className="text-red-500 text-[11px]">{rowError.message}</p>}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Feedback item #10 — confirmation popup before a destructive action. */}
      {confirmingId && (
        <ConfirmDialog
          title="Cancel this leave request?"
          message="This will withdraw the request. If it was already approved, the debited days will be credited back to your balance."
          confirmLabel={busyId === confirmingId ? 'Cancelling…' : 'Yes, cancel it'}
          cancelLabel="Keep it"
          onConfirm={() => handleConfirmCancel(confirmingId)}
          onCancel={() => setConfirmingId(null)}
        />
      )}
    </div>
  );
}