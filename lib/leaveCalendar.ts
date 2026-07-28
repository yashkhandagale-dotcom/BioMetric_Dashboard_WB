import { AbsenteeCandidate, HalfDayCandidate } from './attendanceExceptions';
import { mapTrackerLeaveType, TrackerLeaveTypeCode } from './leaveSupabase/leaveTypeMap';
import { LEAVE_COLORS, LEAVE_LABELS, UNMARKED_LEAVE_LABEL } from './leaveLabels';

// ── Month-grid utilities ─────────────────────────────────────────────────
// No existing week-start convention was found anywhere else in the repo
// (checked predefinedHolidays.ts and every other date-grid-shaped file —
// see the brief's section 5.2). Defaulting to Monday-start, since that's
// the convention already implied by this being an India-based HR tool
// (Mon–Sat/Sun work weeks), and is easy to change in one place below if
// that assumption is wrong.
export const WEEK_START: 'monday' | 'sunday' = 'monday';

export function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthBounds(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start: toYMD(start), end: toYMD(end) };
}

/**
 * Every date cell to render for a given month, including the leading/
 * trailing days from adjacent months needed to fill whole weeks — those
 * are flagged `inMonth: false` so the grid can de-emphasize them rather
 * than omit them (a ragged first/last row reads as broken, not minimal).
 */
export function buildMonthGrid(monthKey: string): { date: string; inMonth: boolean }[] {
  const [y, m] = monthKey.split('-').map(Number);
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const lastOfMonth = new Date(Date.UTC(y, m, 0));

  // JS getUTCDay(): 0=Sun..6=Sat. Convert to a Monday-start offset.
  const firstWeekday = firstOfMonth.getUTCDay();
  const leadingCount = WEEK_START === 'monday' ? (firstWeekday + 6) % 7 : firstWeekday;

  const lastWeekday = lastOfMonth.getUTCDay();
  const trailingCount = WEEK_START === 'monday' ? (7 - ((lastWeekday + 6) % 7) - 1) : 7 - lastWeekday - 1;

  const cells: { date: string; inMonth: boolean }[] = [];
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - leadingCount);
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + trailingCount);

  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    cells.push({ date: toYMD(cursor), inMonth: cursor.getUTCMonth() === m - 1 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cells;
}

export const WEEKDAY_LABELS =
  WEEK_START === 'monday'
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Data-merge logic (brief section 2) ───────────────────────────────────

export type LeaveHistoryLite = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  leaveTypeCode: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  halfDaySession: string | null;
  status: string; // 'approved' | 'pending' | ...
  isLwpOverride: boolean;
};

export type CalendarEntryKind = 'leave' | 'unresolved_absent' | 'unresolved_half_day';

export type CalendarDayEntry = {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  kind: CalendarEntryKind;
  status: 'approved' | 'pending' | 'unrecorded';
  label: string;
  colorClass: string;
  isLwpOverride: boolean;
  leaveRequestId?: string;
  halfDayReason?: string; // HalfDayCandidate.reason — missed punch-out / only one punch / <5hr span
};

function expandDatesInRange(start: string, end: string, rangeStart: string, rangeEnd: string): string[] {
  const from = start < rangeStart ? rangeStart : start;
  const to = end > rangeEnd ? rangeEnd : end;
  if (from > to) return [];
  const dates: string[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(toYMD(cursor));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

/**
 * Builds date -> employeeId -> entry for a range, applying the priority
 * rule from the brief (section 2): an approved leave_requests row wins
 * and sets the leave-type color; only when no leave request covers that
 * date does the raw attendance-exception classification (absent /
 * half-day / missed-punch) show, as a visually distinct "unrecorded"
 * marker. A pending (not yet approved) leave_requests row still wins
 * over an attendance-exception row for the same day too — the moment HR
 * has *something* recorded for that employee/day, showing a second,
 * contradictory "unrecorded absence" marker next to it would be
 * confusing, not informative.
 */
export function mergeCalendarDay(
  rangeStart: string,
  rangeEnd: string,
  leaveRequests: LeaveHistoryLite[],
  absentees: AbsenteeCandidate[],
  halfDayCandidates: HalfDayCandidate[]
): Map<string, Map<string, CalendarDayEntry>> {
  const byDate = new Map<string, Map<string, CalendarDayEntry>>();

  function set(date: string, employeeId: string, entry: CalendarDayEntry) {
    const day = byDate.get(date) ?? new Map<string, CalendarDayEntry>();
    day.set(employeeId, entry);
    byDate.set(date, day);
  }
  function has(date: string, employeeId: string): boolean {
    return !!byDate.get(date)?.has(employeeId);
  }

  // Leave requests first — they win the priority contest, so lay them
  // down before any attendance-exception row gets a chance to.
  for (const r of leaveRequests) {
    if (r.status !== 'approved' && r.status !== 'pending') continue; // rejected/cancelled don't occupy a day
    const dates = expandDatesInRange(r.startDate, r.endDate, rangeStart, rangeEnd);
    const mapped = mapTrackerLeaveType(r.leaveTypeCode as TrackerLeaveTypeCode, r.isHalfDay);
    const displayType = mapped.halfDayLeaveType ?? mapped.leaveType;
    const label = r.isHalfDay
      ? `Half Day — ${LEAVE_LABELS[mapped.halfDayLeaveType!]}${r.halfDaySession ? ` (${r.halfDaySession})` : ''}`
      : LEAVE_LABELS[mapped.leaveType];

    for (const date of dates) {
      // If both an approved and a pending row somehow land on the same
      // employee/day, approved wins — it's the more final fact.
      const existing = byDate.get(date)?.get(r.employeeId);
      if (existing && existing.status === 'approved' && r.status === 'pending') continue;

      set(date, r.employeeId, {
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        employeeCode: r.employeeCode,
        department: r.department,
        office: r.office,
        kind: 'leave',
        status: r.status === 'approved' ? 'approved' : 'pending',
        label,
        colorClass: LEAVE_COLORS[displayType],
        isLwpOverride: r.isLwpOverride,
        leaveRequestId: r.id,
      });
    }
  }

  // Attendance-exception rows only fill in where nothing above already
  // claimed that employee/day.
  for (const a of absentees) {
    if (has(a.date, a.employeeId)) continue;
    set(a.date, a.employeeId, {
      employeeId: a.employeeId,
      employeeName: a.employeeName,
      employeeCode: a.employeeCode,
      department: a.department,
      office: a.office,
      kind: 'unresolved_absent',
      status: 'unrecorded',
      label: UNMARKED_LEAVE_LABEL,
      colorClass: 'bg-red-500/20 text-red-400',
      isLwpOverride: false,
    });
  }
  for (const h of halfDayCandidates) {
    if (has(h.date, h.employeeId)) continue;
    set(h.date, h.employeeId, {
      employeeId: h.employeeId,
      employeeName: h.employeeName,
      employeeCode: h.employeeCode,
      department: h.department,
      office: h.office,
      kind: 'unresolved_half_day',
      status: 'unrecorded',
      label: h.reason.toLowerCase().includes('missed punch') ? 'Missed punch-out' : 'Possible half day',
      colorClass: 'bg-amber-500/20 text-amber-400',
      isLwpOverride: false,
      halfDayReason: h.reason,
    });
  }

  return byDate;
}
