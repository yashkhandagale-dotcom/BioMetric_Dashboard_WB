'use client';

import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  Layers,
  Search,
  Calendar,
  Clock,
  AlertCircle,
  RotateCcw,
  CheckCircle2,
  CalendarRange,
} from 'lucide-react';
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
  pending: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/25',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25',
  auto_lwp: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/25',
  cancelled: 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border)]',
};

function statusLabel(status: string): string {
  if (status === 'auto_lwp') return 'Approved (LWP)';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function leaveTypeBadge(code: string, label: string) {
  const c = code.toUpperCase();
  let style = 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25';
  if (c === 'SL') style = 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25';
  else if (c === 'CL') style = 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25';
  else if (c === 'PL') style = 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25';
  else if (c === 'LWP') style = 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/25';

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1 border shadow-2xs ${style}`}>
      <span className="font-mono text-[10px] font-bold opacity-85">{code}</span>
      <span className="text-[var(--text-muted)]">·</span>
      <span className="truncate max-w-[120px]">{label}</span>
    </span>
  );
}

function formatMonthHeader(monthKey: string) {
  const [year, month] = monthKey.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString('default', { month: 'long', year: 'numeric' });
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

  // Correction & Adjustment state
  const [correctingRow, setCorrectingRow] = useState<LeaveHistoryRow | null>(null);
  const [correctMode, setCorrectMode] = useState<'adjust' | 'reverse'>('adjust');
  const [adjustedDays, setAdjustedDays] = useState<number>(0);
  const [adjustedStartDate, setAdjustedStartDate] = useState<string>('');
  const [adjustedEndDate, setAdjustedEndDate] = useState<string>('');
  const [firstDayHalfDay, setFirstDayHalfDay] = useState<boolean>(false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>('AM');
  const [correctionReason, setCorrectionReason] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [groupByMonth, setGroupByMonth] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const displayRows = useMemo(() => consolidateLeaveRows(rows), [rows]);

  // Check if every row in the dataset belongs to the same employee.
  // In single-employee views (e.g. /leave/me or single-person filter),
  // hiding the employee column prevents 100% redundant repetition.
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

  function openCorrectModal(row: LeaveHistoryRow) {
    setCorrectingRow(row);
    setCorrectMode('adjust');
    setAdjustedDays(row.totalDays);
    setAdjustedStartDate(row.startDate);
    setAdjustedEndDate(row.endDate);
    setFirstDayHalfDay(row.isHalfDay);
    setHalfDaySession((row.halfDaySession as 'AM' | 'PM') || 'AM');
    setCorrectionReason('');
    setRowError(null);
  }

  function applyFirstDayHalfDayShortcut() {
    if (!correctingRow) return;
    const newDays = Math.max(0.5, Number((correctingRow.totalDays - 0.5).toFixed(1)));
    setAdjustedDays(newDays);
    setFirstDayHalfDay(true);
    if (!correctionReason.trim()) {
      setCorrectionReason('First day was a half day, employee attended in the afternoon.');
    }
  }

  function applyLastDayHalfDayShortcut() {
    if (!correctingRow) return;
    const newDays = Math.max(0.5, Number((correctingRow.totalDays - 0.5).toFixed(1)));
    setAdjustedDays(newDays);
    if (!correctionReason.trim()) {
      setCorrectionReason('Last day was a half day, employee left early.');
    }
  }

  async function handleConfirmCorrect() {
    if (!correctingRow) return;
    if (!correctionReason.trim()) {
      setRowError({ id: correctingRow.id, message: 'A reason is required to submit a correction.' });
      return;
    }
    if (correctMode === 'adjust' && (adjustedDays <= 0 || (adjustedDays * 2) % 1 !== 0)) {
      setRowError({
        id: correctingRow.id,
        message: 'Total days must be in increments of 0.5 (e.g. 0.5, 1.0, 3.5).',
      });
      return;
    }

    setBusyId(correctingRow.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/leave/requests/${correctingRow.id}/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: correctMode,
          reason: correctionReason.trim(),
          newTotalDays: correctMode === 'adjust' ? adjustedDays : 0,
          newStartDate: adjustedStartDate,
          newEndDate: adjustedEndDate,
          firstDayHalfDay,
          firstDaySession: halfDaySession,
        }),
      });
      const text = await res.text();
      const body = text ? JSON.parse(text) : {};
      if (!res.ok) {
        setRowError({ id: correctingRow.id, message: body.error || 'Could not correct this request.' });
        return;
      }
      setCorrectingRow(null);
      refresh();
    } catch {
      setRowError({ id: correctingRow.id, message: 'Could not reach the server — check your connection and retry.' });
    } finally {
      setBusyId(null);
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
                        {g.rows.map((r) => renderRow(r))}
                      </React.Fragment>
                    ))
                  ) : (
                    pagedRows.map((r) => renderRow(r))
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
        <Modal
          onClose={() => {
            setCorrectingRow(null);
            setCorrectionReason('');
          }}
          title="Correct or Reverse Leave Record"
          description={`Adjust leave days or reverse record for ${correctingRow.employeeName} (${correctingRow.employeeCode}).`}
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  setCorrectingRow(null);
                  setCorrectionReason('');
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated)]/80 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCorrect}
                disabled={busyId === correctingRow.id || !correctionReason.trim()}
                className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition-colors shadow-2xs ${
                  correctMode === 'reverse'
                    ? 'bg-red-600 hover:bg-red-500 disabled:opacity-50'
                    : 'bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50'
                }`}
              >
                {busyId === correctingRow.id
                  ? 'Saving…'
                  : correctMode === 'reverse'
                  ? 'Confirm Full Reversal'
                  : 'Save Correction'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Record Overview */}
            <div className="bg-[var(--bg-elevated)]/60 border border-[var(--border)] rounded-xl p-3 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[var(--text-primary)]">{correctingRow.employeeName}</span>
                <span className="font-semibold text-[var(--accent)]">{correctingRow.leaveTypeLabel}</span>
              </div>
              <p className="text-[var(--text-muted)]">
                Current:{' '}
                <span className="font-semibold text-[var(--text-primary)]">
                  {formatOrdinalDateRange(
                    correctingRow.startDate,
                    correctingRow.endDate,
                    correctingRow.isHalfDay,
                    correctingRow.totalDays
                  )}
                </span>{' '}
                · <span className="font-bold">{correctingRow.totalDays.toFixed(1)} days</span>
              </p>
            </div>

            {/* Mode Switcher */}
            <div className="grid grid-cols-2 gap-1 bg-[var(--bg-elevated)] p-1 rounded-xl border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setCorrectMode('adjust')}
                className={`py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  correctMode === 'adjust'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                ✏️ Adjust Leave Days
              </button>
              <button
                type="button"
                onClick={() => setCorrectMode('reverse')}
                className={`py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  correctMode === 'reverse'
                    ? 'bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/25 shadow-2xs'
                    : 'text-[var(--text-muted)] hover:text-red-600'
                }`}
              >
                🔄 Full Reverse (0 days)
              </button>
            </div>

            {correctMode === 'adjust' ? (
              <div className="space-y-3.5">
                {/* Quick Shortcuts */}
                {correctingRow.totalDays > 0.5 && (
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Quick Half-Day Adjustments
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={applyFirstDayHalfDayShortcut}
                        className="inline-flex items-center gap-1 text-xs font-medium rounded-lg px-2.5 py-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/20 transition-colors"
                      >
                        ⚡ First day is half-day (-0.5 day)
                      </button>
                      <button
                        type="button"
                        onClick={applyLastDayHalfDayShortcut}
                        className="inline-flex items-center gap-1 text-xs font-medium rounded-lg px-2.5 py-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/20 transition-colors"
                      >
                        ⚡ Last day is half-day (-0.5 day)
                      </button>
                    </div>
                  </div>
                )}

                {/* Adjusted Days Field */}
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                    Adjusted Total Working Days
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAdjustedDays((d) => Math.max(0.5, Number((d - 0.5).toFixed(1))))}
                      className="h-8 w-8 flex items-center justify-center rounded-lg border border-[var(--border)] text-sm font-bold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={adjustedDays}
                      onChange={(e) => setAdjustedDays(Number(e.target.value))}
                      className="w-24 text-center font-bold text-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl py-1.5 text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => setAdjustedDays((d) => Number((d + 0.5).toFixed(1)))}
                      className="h-8 w-8 flex items-center justify-center rounded-lg border border-[var(--border)] text-sm font-bold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                    >
                      +
                    </button>
                    <span className="text-xs text-[var(--text-muted)] font-medium">days</span>
                  </div>
                </div>

                {/* Live Balance Impact Preview */}
                {(() => {
                  const delta = Number((correctingRow.totalDays - adjustedDays).toFixed(1));
                  if (delta > 0) {
                    return (
                      <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs">
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold">Balance Refund: +{delta} day(s)</p>
                          <p className="text-[11px] opacity-85 mt-0.5">
                            {delta} day(s) will be credited back to {correctingRow.employeeName}&apos;s{' '}
                            {correctingRow.leaveTypeCode} balance.
                          </p>
                        </div>
                      </div>
                    );
                  }
                  if (delta < 0) {
                    return (
                      <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold">Additional Deduction: {Math.abs(delta)} day(s)</p>
                          <p className="text-[11px] opacity-85 mt-0.5">
                            {Math.abs(delta)} extra day(s) will be debited from {correctingRow.employeeName}&apos;s
                            balance.
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <p className="text-[11px] text-[var(--text-muted)] italic">
                      No change in total days ({adjustedDays} days).
                    </p>
                  );
                })()}

                {/* Session selection if single half-day */}
                {adjustedDays === 0.5 && (
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                      Half-Day Session
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setHalfDaySession('AM')}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                          halfDaySession === 'AM'
                            ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                            : 'border-[var(--border)] text-[var(--text-muted)]'
                        }`}
                      >
                        First Half (AM)
                      </button>
                      <button
                        type="button"
                        onClick={() => setHalfDaySession('PM')}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                          halfDaySession === 'PM'
                            ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                            : 'border-[var(--border)] text-[var(--text-muted)]'
                        }`}
                      >
                        Second Half (PM)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-300 text-xs space-y-1">
                <p className="font-bold">Full Reversal Warning</p>
                <p className="text-[11px] leading-relaxed">
                  This will cancel the entire leave request and credit {correctingRow.totalDays.toFixed(1)} day(s)
                  back to {correctingRow.employeeName}&apos;s balance.
                </p>
              </div>
            )}

            {/* Mandatory Reason Field */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                Reason for correction <span className="text-red-500">*</span>
              </label>
              <textarea
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                rows={2}
                placeholder={
                  correctMode === 'adjust'
                    ? "e.g. 'First day was a half day, employee attended in the afternoon.'"
                    : "e.g. 'Employee actually attended that day — marked in error.'"
                }
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]"
              />
            </div>

            {rowError?.id === correctingRow.id && (
              <p className="text-red-500 text-xs font-medium">{rowError.message}</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );

  function renderRow(r: LeaveHistoryRow) {
    const alreadyStarted = r.status !== 'pending' && r.startDate <= todayYMD();
    const showCancel =
      (showActions || allowHrCancel) &&
      (r.status === 'pending' || r.status === 'approved' || r.status === 'auto_lwp');
    const showReapply = showActions && r.status === 'rejected';
    const showCorrect = hrCorrection && (r.status === 'approved' || r.status === 'auto_lwp');

    return (
      <tr
        key={r.id}
        className="hover:bg-[var(--bg-surface)]/60 transition-colors group"
      >
        {/* Date Range & Duration */}
        <td className="py-3 px-4 align-top">
          <div className="space-y-1">
            <p className="font-semibold text-[var(--text-primary)] text-xs">
              {formatOrdinalDateRange(r.startDate, r.endDate, r.isHalfDay, r.totalDays)}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-[var(--accent)] text-xs tabular-nums">
                {r.totalDays.toFixed(1)} {r.totalDays === 1 ? 'day' : 'days'}
              </span>
              {r.isConsolidated && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/15 border border-emerald-500/20 rounded-md px-1.5 py-0.2">
                  <Layers size={10} /> Continuous ({r.constituentCount ?? 2} spans)
                </span>
              )}
            </div>
          </div>
        </td>

        {/* Employee Column (Only rendered when there are multiple employees) */}
        {!isSingleEmployee && (
          <td className="py-3 px-4 align-top">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-bold">
                {initials(r.employeeName)}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-[var(--text-primary)] text-xs truncate max-w-[150px]">
                  {r.employeeName}
                </p>
                <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
                  {r.employeeCode} · <span className="font-medium text-[var(--text-primary)]">{r.department}</span>
                </p>
              </div>
            </div>
          </td>
        )}

        {/* Leave Type */}
        <td className="py-3 px-4 align-top">
          {leaveTypeBadge(r.leaveTypeCode, r.leaveTypeLabel)}
        </td>

        {/* Details & Attributes */}
        <td className="py-3 px-4 align-top">
          <div className="space-y-1">
            <div className="flex items-center gap-1 flex-wrap">
              {r.isHalfDay && (
                <span className="inline-flex items-center text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/15 border border-amber-500/25 rounded px-1.5 py-0.5">
                  Half Day ({r.halfDaySession ?? 'Session'})
                </span>
              )}

              {r.isLwpOverride && (
                <span className="inline-flex items-center text-[10px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-500/15 border border-purple-500/25 rounded px-1.5 py-0.5">
                  LWP Override
                </span>
              )}

              {!r.isHalfDay && !r.isLwpOverride && (
                <span className="text-[11px] text-[var(--text-muted)]">Standard full day</span>
              )}
            </div>

            <p className="text-[10px] text-[var(--text-muted)]">
              Applied {formatOrdinalDate(r.appliedOn)} · {r.recordedBy}
            </p>
          </div>
        </td>

        {/* Status */}
        <td className="py-3 px-4 align-top">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[11px] font-bold rounded-full px-2.5 py-0.5 whitespace-nowrap ${
                STATUS_STYLE[r.status] ?? 'bg-[var(--text-muted)]/15 text-[var(--text-muted)]'
              }`}
            >
              {r.status === 'cancelled' && r.correctedByName ? 'Reversed by HR' : statusLabel(r.status)}
            </span>

            {r.status === 'cancelled' && r.correctedByName && (
              <InfoTooltip
                title="Reversed by HR"
                description={`${r.correctedByName} reversed this record.${
                  r.correctionReason ? ` Reason: ${r.correctionReason}` : ''
                }`}
              />
            )}
          </div>
        </td>

        {/* Actions */}
        {hasActionsColumn && (
          <td className="py-3 px-4 align-top text-right">
            <div className="flex items-center justify-end gap-1.5 flex-wrap">
              {showCancel && (
                <button
                  type="button"
                  disabled={busyId === r.id || alreadyStarted}
                  title={alreadyStarted ? 'This leave has already started — it can no longer be cancelled.' : undefined}
                  onClick={() => setConfirmingId(r.id)}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {r.status === 'pending' ? 'Withdraw' : 'Cancel'}
                </button>
              )}

              {showReapply && (
                <button
                  type="button"
                  onClick={() => handleReapply(r)}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold text-[var(--accent)] bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 transition-colors"
                >
                  Reapply
                </button>
              )}

              {showCorrect && (
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => openCorrectModal(r)}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
                >
                  Correct / Reverse
                </button>
              )}
            </div>

            {rowError?.id === r.id && (
              <p className="text-red-500 text-[10px] mt-1 text-right font-medium">{rowError.message}</p>
            )}
          </td>
        )}
      </tr>
    );
  }
}