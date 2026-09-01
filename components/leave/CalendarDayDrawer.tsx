'use client';

import { useEffect, useState } from 'react';
import { X, Clock, CheckCircle2, CircleDashed, ArrowUpRight, CalendarX2 } from 'lucide-react';
import RecordLeaveDrawer from './RecordLeaveDrawer';
import ViolationBadge from './ViolationBadge';
import type { SubmitResult } from './RecordLeaveForm';
import type { CalendarDayEntry } from '@/lib/leaveCalendar';
import { formatOrdinalDateWithWeekday } from '@/lib/dateFormat';

function formatDrawerDate(date: string) {
  return formatOrdinalDateWithWeekday(date);
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

const STATUS_META: Record<CalendarDayEntry['status'], { icon: typeof Clock; label: string }> = {
  pending: { icon: Clock, label: 'Pending approval' },
  approved: { icon: CheckCircle2, label: 'Approved' },
  unrecorded: { icon: CircleDashed, label: 'Not recorded' },
};

// Reuses RecordLeaveDrawer for the "record this" action (same drawer
// AbsenteesPanel/HalfDayPanel launch), and the same attendance/resolve
// call those panels make once a half-day/absentee row gets a leave
// recorded, so an unresolved row here drops out of future calendar loads
// exactly the way it already drops out of those tabs.
export default function CalendarDayDrawer({
  date,
  entries,
  onClose,
  onResolved,
  onViewInHistory,
  // HR Admin (hr_super_admin) is remind-only — recording leave on an
  // employee's behalf is a plain-HR action. Defaults true so every
  // existing caller keeps its current behavior unless it explicitly
  // passes false.
  canRecordLeave = true,
}: {
  date: string;
  entries: CalendarDayEntry[];
  onClose: () => void;
  onResolved: () => void;
  onViewInHistory: (employeeId: string) => void;
  canRecordLeave?: boolean;
}) {
  const [recordFor, setRecordFor] = useState<CalendarDayEntry | null>(null);
  const [mounted, setMounted] = useState(false);

  // Mount transition: start off-screen/transparent, then flip on next
  // frame so the slide-in + fade actually animate instead of snapping in.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleRecorded(result: SubmitResult) {
    if (!recordFor) return;
    try {
      await fetch('/api/leave/attendance/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: recordFor.employeeId,
          date,
          action: 'leave_recorded',
          leave_request_id: result.leave_request.id,
        }),
      });
    } finally {
      setRecordFor(null);
      onResolved();
    }
  }

  const sorted = [...entries].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const unresolvedCount = sorted.filter((e) => e.status === 'unrecorded').length;

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
        mounted ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
    >
      <div
        className={`h-full w-full max-w-md bg-[var(--bg-surface)] border-l border-[var(--border)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          mounted ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-[var(--text-primary)] font-semibold text-base leading-tight">
              {formatDrawerDate(date)}
            </h3>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-[var(--text-muted)] text-xs">
                {sorted.length} {sorted.length === 1 ? 'employee' : 'employees'}
              </span>
              {unresolvedCount > 0 && (
                <span className="text-xs text-amber-500 font-medium">
                  · {unresolvedCount} unrecorded
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* List */}
        <div className="scroll-thin flex-1 overflow-y-auto p-4 space-y-2">
          {sorted.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-16 gap-2">
              <CalendarX2 size={28} className="text-[var(--text-muted)]" />
              <p className="text-[var(--text-muted)] text-sm">Nothing to review for this day.</p>
            </div>
          )}

          {sorted.map((entry) => {
            const meta = STATUS_META[entry.status] ?? STATUS_META.unrecorded;
            const StatusIcon = meta.icon;

            return (
              <div
                key={entry.employeeId}
                className="group bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-3 hover:border-[var(--accent)]/40 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-xs font-semibold">
                    {initials(entry.employeeName)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[var(--text-primary)] text-sm font-medium truncate">
                          {entry.employeeName}
                        </p>
                        <p className="text-[var(--text-muted)] text-xs truncate mt-0.5">
                          {entry.employeeCode} · {entry.department} · {entry.office}
                        </p>
                      </div>
                      <ViolationBadge count={entry.isLwpOverride ? 1 : undefined} />
                    </div>

                    <div className="flex items-center gap-1.5 mt-2">
                      <span
                        className={`inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 ${entry.colorClass}`}
                      >
                        <StatusIcon size={11} />
                        {entry.label}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">{meta.label}</span>
                    </div>

                    <div className="flex items-center gap-4 mt-2.5">
                      {entry.status === 'unrecorded' && canRecordLeave && (
                        <button
                          type="button"
                          onClick={() => setRecordFor(entry)}
                          className="text-xs bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                        >
                          Record leave
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onViewInHistory(entry.employeeId)}
                        className="inline-flex items-center gap-0.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        View full record
                        <ArrowUpRight
                          size={12}
                          className="opacity-0 -translate-x-0.5 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
                        />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {recordFor && (
        <RecordLeaveDrawer
          employeeId={recordFor.employeeId}
          employeeName={recordFor.employeeName}
          presetDate={date}
          presetIsHalfDay={recordFor.kind === 'unresolved_half_day'}
          lockHalfDay={recordFor.kind === 'unresolved_half_day'}
          onClose={() => setRecordFor(null)}
          onSuccess={handleRecorded}
        />
      )}
    </div>
  );
}