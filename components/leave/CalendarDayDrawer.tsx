'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import RecordLeaveDrawer from './RecordLeaveDrawer';
import ViolationBadge from './ViolationBadge';
import type { SubmitResult } from './RecordLeaveForm';
import type { CalendarDayEntry } from '@/lib/leaveCalendar';

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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-md bg-[var(--bg-surface)] border-l border-[var(--border)] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div>
            <h3 className="text-[var(--text-primary)] font-semibold text-sm">{date}</h3>
            <p className="text-[var(--text-muted)] text-xs mt-0.5">
              {sorted.length} employee{sorted.length === 1 ? '' : 's'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto p-4 space-y-2">
          {sorted.length === 0 && (
            <p className="text-[var(--text-muted)] text-sm text-center py-10">
              Nothing to review for this day.
            </p>
          )}
          {sorted.map((entry) => (
            <div key={entry.employeeId} className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[var(--text-primary)] text-sm font-medium truncate">{entry.employeeName}</p>
                  <p className="text-[var(--text-muted)] text-xs truncate">
                    {entry.employeeCode} · {entry.department} · {entry.office}
                  </p>
                </div>
                <ViolationBadge count={entry.isLwpOverride ? 1 : undefined} />
              </div>

              <div className="flex items-center gap-2 mt-2">
                <span
                  className={`text-xs rounded-full px-2 py-0.5 ${entry.colorClass} ${
                    entry.status === 'pending' ? 'border border-dashed border-current' : ''
                  } ${entry.status === 'unrecorded' ? 'border border-dotted border-current' : ''}`}
                >
                  {entry.label}
                </span>
                {entry.status === 'pending' && (
                  <span className="text-[11px] text-[var(--text-muted)]">Pending approval</span>
                )}
                {entry.status === 'approved' && (
                  <span className="text-[11px] text-[var(--text-muted)]">Approved</span>
                )}
              </div>

              <div className="flex items-center gap-3 mt-2">
                {entry.status === 'unrecorded' && canRecordLeave && (
                  <button
                    type="button"
                    onClick={() => setRecordFor(entry)}
                    className="text-xs bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white font-medium px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    Record Leave
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onViewInHistory(entry.employeeId)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  View full record →
                </button>
              </div>
            </div>
          ))}
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
