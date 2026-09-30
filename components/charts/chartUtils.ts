import { AttendanceRecord, LeaveRecord } from '@/lib/types';
import { computeLateMinutes, computeEarlyMinutes } from '@/lib/useDashboardData';

export function rateColor(rate: number): string {
  if (rate >= 80) return '#34d399';
  if (rate >= 70) return '#fbbf24';
  return '#f87171';
}

// Wider 5-tier gradient for the monthly heatmap view (rateColor's 3 tiers
// are fine for a single tooltip line, but a grid of colored cells benefits
// from more visual separation between "70% attendance" and "95% attendance"
// than 2 buckets would give).
export function monthlyAttendanceColor(pct: number): string {
  if (pct >= 90) return '#059669';
  if (pct >= 75) return '#34d399';
  if (pct >= 60) return '#fbbf24';
  if (pct >= 40) return '#f97316';
  return '#f87171';
}

export type SortMode = 'default' | 'az' | 'worst' | 'best';

export type DayNavProps = {
  date?: string;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  canGoPrev?: boolean;
  canGoNext?: boolean;
};

export function getDepartmentFromClick(entry: any): string | null {
  return entry?.department
    ?? entry?.payload?.department
    ?? entry?.data?.department
    ?? entry?.activePayload?.[0]?.payload?.department
    ?? entry?.activePayload?.[0]?.payload?.payload?.department
    ?? entry?.activePayload?.[0]?.payload?.name
    ?? entry?.activePayload?.[0]?.name
    ?? null;
}

export const COMPARISON_LINE_COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa'];

export const STATUS_COLORS_CELL: Record<string, string> = {
  present: '#34d399',
  late: '#fbbf24',
  earlyexit: '#60a5fa',
  // 'absent' here means "unmarked leave" — an absent day nobody has
  // recorded a leave for yet. Kept as the key 'absent' internally (so it
  // still falls back correctly wherever a leave record isn't looked up),
  // but always labeled "Unmarked Leave" to the user — see UNMARKED_LEAVE_LABEL.
  absent: '#f87171',
  // A day HR has marked a leave for — distinct color from unmarked so the
  // two are visually distinguishable at a glance.
  on_leave: '#38bdf8',
  missed_punch_out: '#d97706',
  weeklyoff: '#334155',
  shortday: '#f97316',
  holiday: '#a78bfa',
};

export function getCellStatus(
  r: AttendanceRecord,
  graceMinutes: number = 10,
  shiftStartMinutes?: number,
  shiftEndMinutes?: number,
  leave?: LeaveRecord
): string {
  // Leave takes priority over everything else, same as the day-wise
  // status badge in EmployeePanel.tsx — a marked leave is the most
  // specific, most authoritative thing known about that day.
  if (leave) return 'on_leave';
  const s = r.status.toLowerCase();
  if (s.includes('sick') || s.includes('planned') || s.includes('casual') || s.includes('lwp')) return 'on_leave';
  if (r.isShortDay) return 'shortday';
  if (s.includes('weeklyoff')) return 'weeklyoff';
  if (s.includes('absent')) return 'absent';
  if (s.includes('present')) {
    if (computeLateMinutes(r.inTime, graceMinutes, shiftStartMinutes) > 0) return 'late';
    if (computeEarlyMinutes(r.outTime, graceMinutes, shiftEndMinutes) > 0) return 'earlyexit';
    return 'present';
  }
  return 'absent';
}
