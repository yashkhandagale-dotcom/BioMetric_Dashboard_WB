'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '../ConfirmDialog';
import InfoTooltip from '../InfoTooltip';
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
  // Present only on a status='cancelled' row that HR reversed after the
  // fact via the /correct route (see LEAVE_TRACKER correction feature) —
  // distinct from a normal employee/HR cancel, which leaves these null.
  correctedByName?: string | null;
  correctionReason?: string | null;
};

function formatDateRange(start: string, end: string) {
  return start === end ? start : `${start} → ${end}`;
}

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  auto_lwp: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-300',
  cancelled: 'bg-[var(--text-muted)]/15 text-[var(--text-muted)]',
};

function statusLabel(status: string): string {
  if (status === 'auto_lwp') return 'Approved (LWP)';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Small styled action button shared by the row-level actions below, so
// Withdraw/Cancel, Reapply, and Correct/Reverse all read as the same
// control family instead of three differently-weighted text links.
function RowAction({
  tone,
  disabled,
  title,
  onClick,
  children,
}: {
  tone: 'danger' | 'accent' | 'warn';
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-red-600 dark:text-red-400 hover:bg-red-500/10'
      : tone === 'warn'
      ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
      : 'text-[var(--accent)] hover:bg-[var(--accent)]/10';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`text-xs font-medium rounded-md px-2 py-1 -mx-2 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed ${toneClass}`}
    >
      {children}
    </button>
  );
}

// Shared modal shell (backdrop + header/body/footer chrome) so the two
// modals this table can open — Cancel/Withdraw confirmation is handled
// by ConfirmDialog, but the HR "Correct / Reverse" reason prompt lives
// here — follow one consistent pattern rather than each inventing its
// own spacing and border rhythm.
function Modal({
  onClose,
  title,
  description,
  children,
  footer,
}: {
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">{title}</h3>
          {description && <p className="text-[var(--text-muted)] text-xs mt-1 leading-relaxed">{description}</p>}
        </div>
        <div className="px-5 py-4">{children}</div>
        <div className="px-5 py-4 flex justify-end gap-2 border-t border-[var(--border)]">{footer}</div>
      </div>
    </div>
  );
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
//
// hrCorrection (HR leave-correction feature) — opt-in, separate from
// showActions on purpose: showActions is "this is MY request, act on
// it" (withdraw/cancel/reapply); hrCorrection is "I'm HR, fix someone
// else's already-finished record". Only the admin History table passes
// it. An approved/auto_lwp row gets a "Correct / Reverse" action
// regardless of whether its dates have passed (unlike Withdraw/Cancel,
// which the cancel route blocks once started) — see
// app/api/leave/requests/[id]/correct/route.ts's header comment for why
// this is a distinct action from cancellation. A reason is mandatory
// and shown afterwards via the info icon next to "Cancelled".
export default function LeaveHistoryTable({
  rows,
  showActions = false,
  hrCorrection = false,
  allowHrCancel = false,
  onChanged,
}: {
  rows: LeaveHistoryRow[];
  showActions?: boolean;
  hrCorrection?: boolean;
  allowHrCancel?: boolean;
  // Admin History fetches its own rows client-side rather than via a
  // Server Component (see app/leave/admin/history/page.tsx), so a
  // successful correction needs an explicit refetch hook instead of
  // router.refresh() (which only re-runs Server Components — no-op
  // there). showActions's own /leave/me caller has no onChanged and
  // keeps using router.refresh(), unaffected.
  // allowHrCancel: when true, show the Cancel/Withdraw action for HR
  // users in admin tables so HR can cancel pre-approved or pending requests.
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');

  function refresh() {
    if (onChanged) onChanged();
    else router.refresh();
  }

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
      refresh();
    } catch {
      setRowError({ id, message: 'Could not reach the server — check your connection and retry.' });
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  }

  async function handleConfirmCorrect(id: string) {
    if (!correctionReason.trim()) {
      setRowError({ id, message: 'A reason is required.' });
      return;
    }
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/leave/requests/${id}/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: correctionReason.trim() }),
      });
      const text = await res.text();
      const body = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setRowError({ id, message: body.error || 'Could not correct this request.' });
        return;
      }
      refresh();
    } catch {
      setRowError({ id, message: 'Could not reach the server — check your connection and retry.' });
    } finally {
      setBusyId(null);
      setCorrectingId(null);
      setCorrectionReason('');
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

  const hasActionsColumn = showActions || hrCorrection;

  return (
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-[var(--text-muted)] text-xs uppercase tracking-wide">
              <th className="px-4 py-3 font-medium">Employee</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Dates</th>
              <th className="px-4 py-3 font-medium text-right">Days</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Half-day</th>
              <th className="px-4 py-3 font-medium">LWP</th>
              <th className="px-4 py-3 font-medium">Applied</th>
              <th className="px-4 py-3 font-medium">Recorded by</th>
              {hasActionsColumn && <th className="px-4 py-3 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-[var(--bg-elevated)]/60 transition-colors">
                <td className="px-4 py-3 border-t border-[var(--border)]">
                  <p className="text-[var(--text-primary)] font-medium">{r.employeeName}</p>
                  <p className="text-[var(--text-muted)] text-xs mt-0.5">
                    {r.employeeCode} · {r.department} · {r.office}
                  </p>
                </td>
                <td className="px-4 py-3 border-t border-[var(--border)] text-[var(--text-muted)]">{r.leaveTypeLabel}</td>
                <td className="px-4 py-3 border-t border-[var(--border)] text-[var(--text-muted)] whitespace-nowrap">
                  {formatDateRange(r.startDate, r.endDate)}
                </td>
                <td className="px-4 py-3 border-t border-[var(--border)] text-right tabular-nums text-[var(--text-primary)]">
                  {r.totalDays.toFixed(2)}
                </td>
                <td className="px-4 py-3 border-t border-[var(--border)]">
                  <span className="inline-flex items-center gap-1">
                    <span
                      className={`text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${
                        STATUS_STYLE[r.status] ?? 'bg-[var(--text-muted)]/15 text-[var(--text-muted)]'
                      }`}
                    >
                      {r.status === 'cancelled' && r.correctedByName ? 'Reversed by HR' : statusLabel(r.status)}
                    </span>
                    {r.status === 'cancelled' && r.correctedByName && (
                      <InfoTooltip
                        title="Reversed by HR"
                        description={`${r.correctedByName} reversed this record.${r.correctionReason ? ` Reason: ${r.correctionReason}` : ''}`}
                      />
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 border-t border-[var(--border)] text-[var(--text-muted)]">
                  {r.isHalfDay ? (r.halfDaySession ?? 'Yes') : '—'}
                </td>
                <td className="px-4 py-3 border-t border-[var(--border)]">
                  {r.isLwpOverride ? (
                    <span className="text-amber-600 dark:text-amber-400 text-xs font-medium">Yes</span>
                  ) : (
                    <span className="text-[var(--text-muted)] text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 border-t border-[var(--border)] text-[var(--text-muted)] whitespace-nowrap">
                  {new Date(r.appliedOn).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 border-t border-[var(--border)] text-[var(--text-muted)]">{r.recordedBy}</td>
                {hasActionsColumn && (
                  <td className="px-4 py-3 border-t border-[var(--border)]">
                    <div className="flex flex-col items-start gap-1">
                      {(showActions || allowHrCancel) &&
                        (r.status === 'pending' || r.status === 'approved' || r.status === 'auto_lwp') &&
                        (() => {
                          // Same "already started" rule the cancel API enforces
                          // server-side (app/api/leave/requests/[id]/cancel/route.ts)
                          // — a completed/in-progress approved leave can no
                          // longer be cancelled. Disable the button up front
                          // instead of letting it be clicked and fail.
                          const alreadyStarted = r.status !== 'pending' && r.startDate <= todayYMD();
                          return (
                            <RowAction
                              tone="danger"
                              disabled={busyId === r.id || alreadyStarted}
                              title={
                                alreadyStarted
                                  ? 'This leave has already started — it can no longer be cancelled.'
                                  : undefined
                              }
                              onClick={() => setConfirmingId(r.id)}
                            >
                              {r.status === 'pending' ? 'Withdraw' : 'Cancel'}
                            </RowAction>
                          );
                        })()}
                      {showActions && r.status === 'rejected' && (
                        <RowAction tone="accent" onClick={() => handleReapply(r)}>
                          Apply for another leave type
                        </RowAction>
                      )}
                      {hrCorrection && (r.status === 'approved' || r.status === 'auto_lwp') && (
                        <RowAction
                          tone="warn"
                          disabled={busyId === r.id}
                          onClick={() => {
                            setCorrectingId(r.id);
                            setCorrectionReason('');
                            setRowError(null);
                          }}
                        >
                          Correct / Reverse
                        </RowAction>
                      )}
                      {rowError?.id === r.id && <p className="text-red-500 text-[11px] leading-snug">{rowError.message}</p>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

      {/* HR "Correct / Reverse" — needs a mandatory free-text reason,
          which ConfirmDialog doesn't collect, so this is its own small
          modal, built on the shared Modal shell above. */}
      {correctingId && (
        <Modal
          onClose={() => { setCorrectingId(null); setCorrectionReason(''); }}
          title="Correct / reverse this leave record?"
          description="This credits the debited days back to the employee's balance and marks the record as reversed by HR — for a record that's already approved (or finished) but was wrong. A reason is required and is visible to the employee."
          footer={
            <>
              <button
                type="button"
                onClick={() => { setCorrectingId(null); setCorrectionReason(''); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-muted)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => handleConfirmCorrect(correctingId)}
                disabled={busyId === correctingId || !correctionReason.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors"
              >
                {busyId === correctingId ? 'Reversing…' : 'Yes, reverse it'}
              </button>
            </>
          }
        >
          <label className="block text-xs text-[var(--text-muted)] mb-1">Reason</label>
          <textarea
            autoFocus
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
            rows={3}
            placeholder="e.g. Employee actually attended that day — marked in error."
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          {rowError?.id === correctingId && <p className="text-red-500 text-[11px] mt-1">{rowError.message}</p>}
        </Modal>
      )}
    </div>
  );
}