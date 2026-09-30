'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  Search,
  Calendar,
  Clock,
  CheckCircle2,
  CalendarRange,
} from 'lucide-react';
import ConfirmDialog from '../ConfirmDialog';
import type { ApplyLeaveInitialValues } from './ApplyLeaveForm';
import { formatOrdinalDateRange } from '@/lib/dateFormat';
import { consolidateLeaveRows } from '@/lib/workingDaysCalculator';
import {
  LeaveHistoryRow,
  formatMonthHeader,
} from './history/leaveHistoryTypes';
import LeaveCorrectionModal from './history/LeaveCorrectionModal';
import LeaveHistoryRowItem from './history/LeaveHistoryRowItem';

// Re-export type for existing consumers
export type { LeaveHistoryRow };

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
  const [correctingRow, setCorrectingRow] = useState<LeaveHistoryRow | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [groupByMonth, setGroupByMonth] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const displayRows = useMemo(() => consolidateLeaveRows(rows), [rows]);

  // Check if every row in the dataset belongs to the same employee.
  const isSingleEmployee = useMemo(() => {
    if (displayRows.length === 0) return true;
    const firstId = displayRows[0].employeeId;
    return displayRows.every((r) => r.employeeId === firstId);
  }, [displayRows]);

  // Client-side search across employee name, code, department, leave type, dates
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return displayRows;
    const q = searchQuery.trim().toLowerCase();
    return displayRows.filter(
      (r) =>
        r.employeeName.toLowerCase().includes(q) ||
        r.employeeCode.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.leaveTypeLabel.toLowerCase().includes(q) ||
        r.leaveTypeCode.toLowerCase().includes(q) ||
        r.startDate.includes(q) ||
        r.endDate.includes(q) ||
        r.status.toLowerCase().includes(q)
    );
  }, [displayRows, searchQuery]);

  // Summary statistics
  const summary = useMemo(() => {
    let totalDays = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    for (const r of filteredRows) {
      if (r.status === 'approved' || r.status === 'auto_lwp') {
        totalDays += r.totalDays;
        approvedCount++;
      } else if (r.status === 'pending') {
        pendingCount++;
      }
    }
    return {
      totalRecords: filteredRows.length,
      totalDays: Number(totalDays.toFixed(1)),
      approvedCount,
      pendingCount,
    };
  }, [filteredRows]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize, groupByMonth]);

  function refresh() {
    if (onChanged) onChanged();
    else router.refresh();
  }

  async function handleConfirmCancel(targetId: string) {
    const targetRow = displayRows.find((r) => r.id === targetId);
    const idsToCancel =
      targetRow?.consolidatedIds && targetRow.consolidatedIds.length > 0
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

  function handleReapply(row: LeaveHistoryRow) {
    const detail: ApplyLeaveInitialValues = {
      startDate: row.startDate,
      endDate: row.endDate,
      isHalfDay: row.isHalfDay,
      halfDaySession: (row.halfDaySession as 'AM' | 'PM' | null) ?? undefined,
      reason: `Reapplying after ${row.leaveTypeLabel} was rejected for ${formatOrdinalDateRange(
        row.startDate,
        row.endDate,
        row.isHalfDay,
        row.totalDays
      )}.`,
    };
    window.dispatchEvent(new CustomEvent('leave:reapply', { detail }));
  }

  const hasActionsColumn = showActions || hrCorrection;

  // Pagination slicing
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = groupByMonth
    ? filteredRows
    : filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Month-wise grouping map
  const monthGroups = useMemo(() => {
    if (!groupByMonth) return null;
    const groups: { monthKey: string; rows: LeaveHistoryRow[]; totalDays: number }[] = [];
    const map = new Map<string, { rows: LeaveHistoryRow[]; totalDays: number }>();

    for (const r of pagedRows) {
      const key = r.startDate.slice(0, 7); // 'YYYY-MM'
      if (!map.has(key)) {
        map.set(key, { rows: [], totalDays: 0 });
      }
      const g = map.get(key)!;
      g.rows.push(r);
      if (r.status === 'approved' || r.status === 'auto_lwp') {
        g.totalDays += r.totalDays;
      }
    }

    for (const [monthKey, data] of map.entries()) {
      groups.push({ monthKey, rows: data.rows, totalDays: Number(data.totalDays.toFixed(1)) });
    }
    return groups;
  }, [groupByMonth, pagedRows]);

  if (rows.length === 0) {
    return (
      <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-2xl px-6 py-14 flex flex-col items-center gap-2 text-center">
        <Inbox size={28} className="text-[var(--text-muted)]" />
        <p className="text-[var(--text-primary)] font-medium text-sm">No leave records</p>
        <p className="text-[var(--text-muted)] text-xs">No leave history entries match the current view.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* ── Summary & Control Strip ────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-[var(--bg-elevated)]/50 border border-[var(--border)] rounded-2xl p-3 shadow-2xs">
        {/* Quick Summary Pill Stats */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-semibold shadow-2xs">
            <CalendarRange className="h-3.5 w-3.5 text-[var(--accent)]" />
            {summary.totalRecords} Record{summary.totalRecords === 1 ? '' : 's'}
          </span>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {summary.totalDays} Days Taken
          </span>

          {summary.pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 font-medium">
              <Clock className="h-3.5 w-3.5" />
              {summary.pendingCount} Pending
            </span>
          )}
        </div>

        {/* Search & Month Grouping Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative min-w-[11rem] sm:min-w-[13rem]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search leaves, dates, type…"
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
            />
          </div>

          <button
            type="button"
            onClick={() => setGroupByMonth(!groupByMonth)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              groupByMonth
                ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-2xs'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)]/40'
            }`}
            title="Toggle Month-wise Grouping"
          >
            <Calendar size={13} />
            <span className="hidden sm:inline">By Month</span>
          </button>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="bg-[var(--bg-elevated)]/30 border border-[var(--border)] rounded-2xl p-8 text-center space-y-1">
          <p className="text-[var(--text-primary)] text-sm font-medium">No matching records found</p>
          <p className="text-[var(--text-muted)] text-xs">Try adjusting your search query or clear the filter.</p>
        </div>
      ) : (
        <>
          {/* ── Table Container ───────────────────────────────────────── */}
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]/30 shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-surface)]/90 border-b border-[var(--border)] text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                    <th className="py-3 px-4">Date Range & Duration</th>
                    {!isSingleEmployee && <th className="py-3 px-4">Employee</th>}
                    <th className="py-3 px-4">Leave Type</th>
                    <th className="py-3 px-4">Details</th>
                    <th className="py-3 px-4">Status</th>
                    {hasActionsColumn && <th className="py-3 px-4 text-right">Actions</th>}
                  </tr>
                </thead>

                <tbody className="divide-y divide-[var(--border)]/60">
                  {groupByMonth && monthGroups ? (
                    monthGroups.map((g) => (
                      <React.Fragment key={g.monthKey}>
                        {/* Month Section Header */}
                        <tr className="bg-[var(--bg-surface)]/50 border-y border-[var(--border)]">
                          <td
                            colSpan={hasActionsColumn ? (isSingleEmployee ? 5 : 6) : isSingleEmployee ? 4 : 5}
                            className="py-2 px-4"
                          >
                            <div className="flex items-center justify-between text-xs font-bold text-[var(--text-primary)]">
                              <span className="flex items-center gap-2">
                                <Calendar className="h-3.5 w-3.5 text-[var(--accent)]" />
                                {formatMonthHeader(g.monthKey)}
                              </span>
                              <span className="text-[11px] font-medium text-[var(--text-muted)]">
                                {g.rows.length} leave{g.rows.length === 1 ? '' : 's'} · {g.totalDays} days taken
                              </span>
                            </div>
                          </td>
                        </tr>

                        {/* Rows within Month */}
                        {g.rows.map((r) => (
                          <LeaveHistoryRowItem
                            key={r.id}
                            row={r}
                            isSingleEmployee={isSingleEmployee}
                            hasActionsColumn={hasActionsColumn}
                            showActions={showActions}
                            allowHrCancel={allowHrCancel}
                            hrCorrection={hrCorrection}
                            busyId={busyId}
                            rowError={rowError}
                            onCancel={setConfirmingId}
                            onReapply={handleReapply}
                            onCorrect={setCorrectingRow}
                          />
                        ))}
                      </React.Fragment>
                    ))
                  ) : (
                    pagedRows.map((r) => (
                      <LeaveHistoryRowItem
                        key={r.id}
                        row={r}
                        isSingleEmployee={isSingleEmployee}
                        hasActionsColumn={hasActionsColumn}
                        showActions={showActions}
                        allowHrCancel={allowHrCancel}
                        hrCorrection={hrCorrection}
                        busyId={busyId}
                        rowError={rowError}
                        onCancel={setConfirmingId}
                        onReapply={handleReapply}
                        onCorrect={setCorrectingRow}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Pagination (when not grouped by month) ─────────────────── */}
          {!groupByMonth && pageCount > 1 && (
            <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span>Show</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-2.5 py-1 text-xs text-[var(--text-primary)]"
                >
                  <option value={12}>12</option>
                  <option value={24}>24</option>
                  <option value={48}>48</option>
                </select>
                <span>per page</span>
              </div>

              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span>
                  {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredRows.length)} of{' '}
                  {filteredRows.length}
                </span>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    aria-label="Previous page"
                    className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft size={14} />
                  </button>

                  <span className="text-[var(--text-primary)] font-medium px-2">
                    {currentPage} / {pageCount}
                  </span>

                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    disabled={currentPage === pageCount}
                    aria-label="Next page"
                    className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Confirmation Modal for Cancel/Withdraw */}
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

      {/* HR "Correct / Reverse" Modal */}
      {correctingRow && (
        <LeaveCorrectionModal
          correctingRow={correctingRow}
          onClose={() => setCorrectingRow(null)}
          onSuccess={() => {
            setCorrectingRow(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}