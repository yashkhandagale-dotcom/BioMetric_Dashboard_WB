import type { SupabaseClient } from '@supabase/supabase-js';
import { computeEmployeeKPIs, type ComparisonKPIs } from '../useDashboardData';
import { getPredefinedHolidays } from '../predefinedHolidays';
import { selectAllRows } from '../attendanceExceptions';
import { mapTrackerLeaveType, TrackerLeaveTypeCode } from './leaveTypeMap';
import { DEFAULT_THRESHOLDS } from '../settings';
import type { AttendanceRecord, Holiday, LeaveRecord, LeaveType } from '../types';

// =====================================================================
// A1 (leave-tracker-self-service-and-approvals prompt) — Attendance-KPI
// extraction, out of EmployeeModal.tsx / EmployeeTable.tsx, parameterized
// by employee_id + a date range, callable from both the main dashboard
// and /leave/me.
//
// EmployeeModal.tsx / EmployeeTable.tsx never actually computed KPIs
// themselves — they render a precomputed EmployeeSummary, whose numbers
// come from `computeEmployeeKPIs()` in lib/useDashboardData.ts (see that
// file's header: it's already the shared, pure, non-React function every
// other KPI consumer — Charts.tsx, exportData.ts, this file — imports
// rather than re-deriving. Nothing about attendance rate / late count /
// early-exit count / absent days / productivity loss is reimplemented
// here; this file is purely the "employee_id + date range -> the
// AttendanceRecord[] + LeaveRecord map computeEmployeeKPIs() needs"
// plumbing that didn't exist yet, because every existing caller of
// computeEmployeeKPIs() built that input client-side from an
// already-uploaded in-memory CSV. This is the first *server-side*,
// single-employee caller.
//
// Per the Post-Sprint-2 pivot (see lib/leaveSupabase/server.ts's header),
// the Dashboard and Leave Tracker are one unified Supabase project now —
// attendance_records is the exact same table the main dashboard reads,
// keyed by employee_code/office (not employee_id), so a leave-tracker
// employee's numbers here are guaranteed to match the main dashboard for
// the same person/period; there is no second copy of the data to drift.
// =====================================================================

export interface EmployeeAttendanceKPIs extends ComparisonKPIs {
  // Actual vs Effective hours — per the "Actual/Effective hours labeling
  // convention" (lib/hoursCalc.ts): Actual = raw punch duration incl.
  // lunch; Effective = duration minus a 60-min lunch (excluded from the
  // average entirely on days <= 60 min, never coerced to 0). Both are
  // surfaced here, pre-labeled, so no caller ever displays a single bare
  // "hours" figure — see PersonalAttendanceReport.tsx.
  avgActualHoursPerDay: number;
  avgEffectiveHoursPerDay: number; // same number as ComparisonKPIs.avgHoursPerDay, aliased for clarity at call sites
}

type AttendanceRow = {
  date: string;
  employee_code: string;
  office_code: string;
  in_time: string | null;
  out_time: string | null;
  duration: string | null;
  status: string | null;
  punch_count: number | null;
};

/**
 * Computes the same attendance KPIs the main dashboard's Employee
 * Modal/Table show (attendance rate, late count, early-exit count,
 * absent days, productivity loss, avg hours) for ONE employee over a
 * start_date..end_date window (inclusive), reading live from the shared
 * attendance_records / leave_requests / custom_holidays tables.
 *
 * `supabase` should be a Leave Tracker client (createLeaveClient /
 * createLeaveServiceClient) — both point at the same unified project, so
 * either works; callers that already have a session client from a page
 * should just pass that through rather than opening a second connection.
 */
export async function getEmployeeAttendanceKPIs(
  supabase: SupabaseClient,
  employeeId: string,
  startDate: string,
  endDate: string
): Promise<{ kpis: EmployeeAttendanceKPIs; recordCount: number; error: { message: string } | null }> {
  const { data: employee, error: empError } = await supabase
    .from('employees')
    .select('id, employee_code, office')
    .eq('id', employeeId)
    .single();

  if (empError || !employee) {
    return {
      kpis: emptyKPIs(),
      recordCount: 0,
      error: { message: empError?.message ?? `Employee ${employeeId} not found` },
    };
  }

  const [{ data: attendanceRows, error: attError }, { data: leaveRows, error: leaveError }, { data: customHolidays, error: holError }] =
    await Promise.all([
      selectAllRows<AttendanceRow>((from, to) =>
        supabase
          .from('attendance_records')
          .select('date, employee_code, office_code, in_time, out_time, duration, status, punch_count')
          .eq('employee_code', employee.employee_code)
          .gte('date', startDate)
          .lte('date', endDate)
          .range(from, to)
      ),
      supabase
        .from('leave_requests')
        .select('start_date, end_date, is_half_day, half_day_session, status, leave_types ( code )')
        .eq('employee_id', employeeId)
        .in('status', ['approved', 'auto_lwp'])
        .lte('start_date', endDate)
        .gte('end_date', startDate),
      supabase
        .from('custom_holidays')
        .select('date, name')
        .eq('office_code', employee.office)
        .gte('date', startDate)
        .lte('date', endDate),
    ]);

  const firstError = attError || leaveError || holError;
  if (firstError) {
    return { kpis: emptyKPIs(), recordCount: 0, error: { message: firstError.message } };
  }

  const records: AttendanceRecord[] = (attendanceRows ?? []).map((r) => ({
    date: r.date,
    employeeCode: r.employee_code,
    employeeName: '',
    department: '',
    inTime: r.in_time ?? '',
    outTime: r.out_time ?? '',
    status: r.status ?? '',
    lateBy: '',
    earlyBy: '',
    duration: r.duration ?? '0:00',
    officeCode: r.office_code,
    punchCount: r.punch_count ?? undefined,
  }));

  // Expand each approved leave_requests row into one LeaveRecord per
  // calendar day it covers (clamped to the requested window) — mirrors
  // how lib/leaveTrackerRead.ts already does this for the main
  // dashboard's live-read of this same table, so the two never disagree
  // about which days within a multi-day request count as leave.
  const leaveMap = new Map<string, LeaveRecord>();
  for (const row of leaveRows ?? []) {
    const leaveTypeRel = row.leave_types as { code: TrackerLeaveTypeCode } | { code: TrackerLeaveTypeCode }[] | null;
    const code = Array.isArray(leaveTypeRel) ? leaveTypeRel[0]?.code : leaveTypeRel?.code;
    if (!code) continue;
    const { leaveType, halfDayLeaveType } = mapTrackerLeaveType(code, !!row.is_half_day);
    const from = row.start_date > startDate ? row.start_date : startDate;
    const to = row.end_date < endDate ? row.end_date : endDate;
    for (const date of eachDate(from, to)) {
      leaveMap.set(`${employee.employee_code}__${date}`, {
        employeeCode: employee.employee_code,
        officeCode: employee.office,
        date,
        leaveType: leaveType as LeaveType,
        halfDayLeaveType: halfDayLeaveType as LeaveType | undefined,
        markedAt: new Date().toISOString(),
      });
    }
  }

  const years = Array.from(
    new Set([startDate.slice(0, 4), endDate.slice(0, 4)])
  );
  const predefined = years.flatMap((y) => getPredefinedHolidays(employee.office, y));
  const custom: Holiday[] = (customHolidays ?? []).map((h) => ({ date: h.date, name: h.name, source: 'custom' as const }));
  const predefinedDates = new Set(predefined.map((h) => h.date));
  const holidays: Holiday[] = [...predefined, ...custom.filter((h) => !predefinedDates.has(h.date))];

  // Bug fix: an approved leave_requests row is expanded into leaveMap for
  // every calendar day it covers regardless of whether attendance_records
  // has caught up yet (e.g. leave approved for a future/recent date the
  // biometric CSV for that day hasn't been uploaded for). Previously
  // `records` only ever contained rows that already existed in
  // attendance_records, so any leave-covered date with no attendance row
  // was silently invisible to computeEmployeeKPIs — it never entered
  // workRecords at all, so it counted toward neither "On Leave" nor
  // "Unmarked Absent", even though the exact same date is correctly shown
  // in the employee's Leave History (which reads leave_requests directly,
  // not attendance_records). That produced the "leave taken but Attendance
  // Summary doesn't reflect it" mismatch. Fix: synthesize a placeholder
  // attendance row for any leave-covered working day (not a weekend/
  // holiday — those are excluded from KPIs entirely either way) that has
  // no real attendance_records row, so computeEmployeeKPIs sees it and
  // classifies it via leaveMap exactly like a normal leave day.
  const existingDates = new Set(records.map((r) => r.date));
  for (const leaveRec of leaveMap.values()) {
    const d = leaveRec.date;
    if (existingDates.has(d)) continue;
    if (isWeekendLocal(d) || isHolidayLocal(d, holidays)) continue;
    records.push({
      date: d,
      employeeCode: employee.employee_code,
      employeeName: '',
      department: '',
      inTime: '',
      outTime: '',
      status: 'On Leave (Pending Attendance Sync)',
      lateBy: '',
      earlyBy: '',
      duration: '0:00',
      officeCode: employee.office,
      punchCount: undefined,
    });
    existingDates.add(d);
  }
  records.sort((a, b) => a.date.localeCompare(b.date));

  const t = DEFAULT_THRESHOLDS;
  const comparison = computeEmployeeKPIs(records, leaveMap, holidays, t.graceMinutes, t.shiftStartMinutes, t.shiftEndMinutes);

  // "Actual" hours (lunch included) computed the same way avgHoursPerDay
  // (Effective, lunch excluded) already is inside computeEmployeeKPIs —
  // duplicated here at the same granularity (present, non-short-day
  // records) rather than reopening that function's internals, per its
  // own "single source of truth" comment about lib/hoursCalc.ts.
  const presentWithData = records.filter((r) => {
    const s = r.status.toLowerCase();
    const isPresent = s.includes('present') && !s.includes('absent');
    return isPresent && !isWeeklyOffLocal(r.status);
  });
  const rawDurations = presentWithData.map((r) => durationMinutesLocal(r.duration));
  const avgActualHoursPerDay =
    rawDurations.length > 0 ? rawDurations.reduce((a, b) => a + b, 0) / rawDurations.length / 60 : 0;

  return {
    kpis: {
      ...comparison,
      avgActualHoursPerDay,
      avgEffectiveHoursPerDay: comparison.avgHoursPerDay,
    },
    recordCount: records.length,
    error: null,
  };
}

function emptyKPIs(): EmployeeAttendanceKPIs {
  return {
    attendanceRate: 0, absenteeismRate: 0, avgHoursPerDay: 0, lateArrivalRate: 0, earlyExitRate: 0,
    productivityLost: 0, presentDays: 0, absentDays: 0, approvedLeaveDays: 0, plannedLeaveCount: 0, casualLeaveCount: 0,
    sickLeaveCount: 0, lwpCount: 0, halfDayCount: 0, scheduledDays: 0, presentSampleSize: 0,
    avgActualHoursPerDay: 0, avgEffectiveHoursPerDay: 0,
  };
}

function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

// Local, minimal copies of isWeeklyOff/durationToMinutes's exact rules —
// only used for the Actual-hours average above, which needs the same
// "present, not weekly-off" filter computeEmployeeKPIs applies
// internally but has no exported hook to reuse mid-computation without
// duplicating its whole body. Kept byte-identical to
// lib/useDashboardData.ts / lib/parseCSV.ts's own logic — do not let
// these drift from those.
function isWeeklyOffLocal(status: string): boolean {
  const s = status.toLowerCase();
  return s.includes('weeklyoff') && !s.includes('present');
}

// Used only to decide whether a *synthesized* (no real attendance row yet)
// leave day should be added — real attendance rows already carry their own
// status and go through isWeeklyOff/isHoliday in computeEmployeeKPIs as usual.
function isWeekendLocal(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}
function isHolidayLocal(dateStr: string, holidays: Holiday[]): boolean {
  return holidays.some((h) => h.date === dateStr);
}
function durationMinutesLocal(durationStr: string): number {
  if (!durationStr || durationStr === '0:00' || durationStr === '--') return 0;
  const parts = durationStr.split(':');
  const hours = parseInt(parts[0], 10) || 0;
  const mins = parseInt(parts[1], 10) || 0;
  return hours * 60 + mins;
}