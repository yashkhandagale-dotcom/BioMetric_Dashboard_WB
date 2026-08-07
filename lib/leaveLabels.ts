import { LeaveType } from './types';

// Single source of truth for how each LeaveType is displayed. Anywhere the
// app shows a marked leave (Employee Panel day-wise table, Personal
// Heatmap, Attendance Heatmap tooltips, etc.) should import from here
// instead of hardcoding its own copy — that's how the labels drifted out
// of sync before.
export const LEAVE_LABELS: Record<LeaveType, string> = {
  planned: 'Planned Leave',
  casual: 'Casual Leave',
  sick: 'Sick Leave',
  lwp: 'LWP',
  half_day: 'Half Day',
};

export const LEAVE_COLORS: Record<LeaveType, string> = {
  planned: 'bg-[var(--accent)]/20 text-[var(--accent)]',
  casual: 'bg-cyan-500/20 text-cyan-400',
  sick: 'bg-violet-500/20 text-violet-400',
  lwp: 'bg-orange-500/20 text-orange-400',
  half_day: 'bg-amber-500/20 text-amber-400',
};

// A day is absent for one of exactly two reasons, everywhere in the
// Attendance Dashboard: HR marked a leave for it (leaveLabelFor below), or
// nobody has marked anything yet. The latter is deliberately never called
// plain "Absent" any more — "Unmarked Leave" makes clear it's a pending
// action for HR, not a final state.
export const UNMARKED_LEAVE_LABEL = 'Unmarked Leave';

export function leaveLabelFor(leaveType: LeaveType, halfDayLeaveType?: LeaveType): string {
  if (leaveType === 'half_day' && halfDayLeaveType) {
    return `Half Day — ${LEAVE_LABELS[halfDayLeaveType]}`;
  }
  return LEAVE_LABELS[leaveType];
}
