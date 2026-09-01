'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Inbox, Layers } from 'lucide-react';
import ConfirmDialog from '../ConfirmDialog';
import InfoTooltip from '../InfoTooltip';
import type { ApplyLeaveInitialValues } from './ApplyLeaveForm';
import { formatOrdinalDate, formatOrdinalDateRange } from '@/lib/dateFormat';
import { consolidateLeaveRows } from '@/lib/workingDaysCalculator';

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
  correctedByName?: string | null;
  correctionReason?: string | null;
  consolidatedIds?: string[];
  isConsolidated?: boolean;
  constituentCount?: number;
};

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300',
  approved: 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  auto_lwp: 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300',
  cancelled: 'bg-[var(--bg-surface)] text-[var(--text-muted)]',
};

function statusLabel(status: string): string {
  if (status === 'auto_lwp') return 'Approved (LWP)';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

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
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);

  const displayRows = useMemo(() => consolidateLeaveRows(rows), [rows]);

  useEffect(() => {
    setPage(1);
  }, [displayRows]);

  function refresh() {
    if (onChanged) onChanged();
    else router.refresh();
  }

  async function handleConfirmCancel(targetId: string) {
    const targetRow = displayRows.find((r) => r.id === targetId);
    const idsToCancel = targetRow?.consolidatedIds && targetRow.consolidatedIds.length > 0
      ? targetRow.consolidatedIds
      : [targetId];

    setBusyId(targetId);
    setRowError(null);
    try {
      for (const id of idsToCancel) {
        const res = await fetch(`/api/leave/requests/${id}/cancel`, { method: 'POST' });
        const text = await res.text();
        const body = text ? JSON.parse(text) : {};
        if (!res.ok) {
          setRowError({ id: targetId, message: body.error || 'Could not cancel this request.' });
          return;
        }
      }
      refresh();
    } catch {
      setRowError({ id: targetId, message: 'Could not reach the server — check your connection and retry.' });
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  }

  async function handleConfirmCorrect(targetId: string) {
    if (!correctionReason.trim()) {
      setRowError({ id: targetId, message: 'A reason is required.' });
      return;
    }

    const targetRow = displayRows.find((r) => r.id === targetId);
    const idsToCorrect = targetRow?.consolidatedIds && targetRow.consolidatedIds.length > 0
      ? targetRow.consolidatedIds
      : [targetId];

    setBusyId(targetId);
    setRowError(null);
    try {
      for (const id of idsToCorrect) {
        const res = await fetch(`/api/leave/requests/${id}/correct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: correctionReason.trim() }),
        });
        const text = await res.text();
        const body = text ? JSON.parse(text) : {};
        if (!res.ok) {
          setRowError({ id: targetId, message: body.error || 'Could not correct this request.' });
          return;
        }
      }
      refresh();
    } catch {
      setRowError({ id: targetId, message: 'Could not reach the server — check your connection and retry.' });
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
      reason: `Reapplying after ${row.leaveTypeLabel} was rejected for ${formatOrdinalDateRange(row.startDate, row.endDate, row.isHalfDay, row.totalDays)}.`,
    };
    window.dispatchEvent(new CustomEvent('leave:reapply', { detail }));
  }

  if (rows.length === 0) {
    return (
      <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl px-4 py-14 flex flex-col items-center gap-2 text-center">
        <Inbox size={26} className="text-[var(--text-muted)]" />
        <p className="text-[var(--text-muted)] text-sm">No leave records match the current filters.</p>
      </div>
    );
  }

  const hasActionsColumn = showActions || hrCorrection;
  const pageCount = Math.max(1, Math.ceil(displayRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = displayRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div>
      <p className="text-xs text-[var(--text-muted)] mb-3">
        {displayRows.length} leave record{displayRows.length === 1 ? '' : 's'}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 items-stretch">
        {paged.map((r) => {
          const alreadyStarted = r.status !== 'pending' && r.startDate <= todayYMD();
          const showCancel = (showActions || allowHrCancel) && (r.status === 'pending' || r.status === 'approved' || r.status === 'auto_lwp');
          const showReapply = showActions && r.status === 'rejected';
          const showCorrect = hrCorrection && (r.status === 'approved' || r.status === 'auto_lwp');

          return (
            <div
              key={r.id}
              className="h-full flex flex-col gap-3 bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 hover:border-[var(--accent)]/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs font-semibold">
                    {initials(r.employeeName)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[var(--text-primary)] text-sm font-medium truncate">{r.employeeName}</p>
                    <p className="text-[var(--text-muted)] text-xs truncate mt-0.5">
                      {r.employeeCode} · {r.department} · {r.office}
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 shrink-0">
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
              </div>

              <div className="flex items-center justify-between gap-3 bg-[var(--bg-surface)]/60 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-[var(--text-primary)] text-sm font-medium truncate">{r.leaveTypeLabel}</p>
                    {r.isConsolidated && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/15 border border-emerald-500/20 rounded px-1.5 py-0.5">
                        <Layers size={10} /> Continuous
                      </span>
                    )}
                  </div>
                  <p className="text-[var(--text-muted)] text-xs mt-0.5 whitespace-nowrap">
                    {formatOrdinalDateRange(r.startDate, r.endDate, r.isHalfDay, r.totalDays)}
                  </p>
                </div>
                <p className="shrink-0 text-right">
                  <span className="text-[var(--text-primary)] text-lg font-semibold tabular-nums">
                    {r.totalDays.toFixed(1)}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] ml-1">days</span>
                </p>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Half-day</p>
                  <p className="text-xs text-[var(--text-primary)] mt-0.5">
                    {r.isHalfDay ? (r.halfDaySession ?? 'Yes') : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">LWP</p>
                  <p
                    className={`text-xs mt-0.5 ${
                      r.isLwpOverride ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-[var(--text-primary)]'
                    }`}
                  >
                    {r.isLwpOverride ? 'Yes' : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Applied</p>
                  <p className="text-xs text-[var(--text-primary)] mt-0.5">
                    {formatOrdinalDate(r.appliedOn)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Recorded by</p>
                  <p className="text-xs text-[var(--text-primary)] mt-0.5 truncate">{r.recordedBy}</p>
                </div>
              </div>

              {hasActionsColumn && (showCancel || showReapply || showCorrect || rowError?.id === r.id) && (
                <div className="flex flex-col items-start gap-1 mt-auto pt-2 border-t border-[var(--border)]">
                  {showCancel && (
                    <RowAction
                      tone="danger"
                      disabled={busyId === r.id || alreadyStarted}
                      title={alreadyStarted ? 'This leave has already started — it can no longer be cancelled.' : undefined}
                      onClick={() => setConfirmingId(r.id)}
                    >
                      {r.status === 'pending' ? 'Withdraw' : 'Cancel'}
                    </RowAction>
                  )}
                  {showReapply && (
                    <RowAction tone="accent" onClick={() => handleReapply(r)}>
                      Apply for another leave type
                    </RowAction>
                  )}
                  {showCorrect && (
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
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>Cards per page</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)]"
          >
            <option value={8}>8</option>
            <option value={16}>16</option>
            <option value={32}>32</option>
          </select>
        </div>

        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          <span>
            {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, displayRows.length)} of {displayRows.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              aria-label="Previous page"
              className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-[var(--text-primary)] px-1">
              {currentPage} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={currentPage === pageCount}
              aria-label="Next page"
              className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
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