import type { SupabaseClient } from '@supabase/supabase-js';
import { durationToMinutes, isPunchTimeValid } from './parseCSV';
import { isAbsent, isPresent, isWeeklyOff, isMissedPunchOut } from './useDashboardData';
import { getPredefinedHolidays } from './predefinedHolidays';

// Server-side (Leave Tracker) attendance-exception detection for the
// "Absentees" and "Half Day / Missed Punch" tabs.
//
// Deliberately reuses the Dashboard's existing status-classification
// helpers (isAbsent/isPresent/isWeeklyOff/isMissedPunchOut from
// useDashboardData.ts) and duration parser (durationToMinutes from
// parseCSV.ts) instead of re-deriving "what counts as absent" a second
// time — those already encode the edge cases (weekly-off-but-present,
// missed-punch-out phrasing, etc.) and diverging from them here would
// mean the Dashboard and the Leave Tracker could disagree about the same
// day for the same employee.
//
// HALF_DAY_THRESHOLD_MINUTES matches the requirement: first-punch to
// last-punch <= 5 hours means "don't auto-mark absent, flag for review"
// instead.
const HALF_DAY_THRESHOLD_MINUTES = 5 * 60;

// A date-range query used to be impossible to build without either
// (a) looping the single-date logic and firing the same 6 queries once
// PER DAY in the range (a 30-day range = 180 round trips — this is why
// it was slow), or (b) re-deriving the classification rules a second
// time inline. getAttendanceExceptions and getAttendanceExceptionsRange
// below both go through the same classifyEmployeeDay() so there's one
// place deciding "what counts as an absentee vs a half-day candidate",
// and the range version fetches every table it needs exactly once for
// the whole range, then classifies in memory per day.

export type AbsenteeCandidate = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  office: string;
  workingHours: string;
  status: string;
  date: string;
};

export type HalfDayCandidate = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  office: string;
  workingHours: string;
  firstPunch: string | null;
  lastPunch: string | null;
  reason: string;
  status: string;
  date: string;
};

export type ExceptionResult = {
  absentees: AbsenteeCandidate[];
  halfDayCandidates: HalfDayCandidate[];
  date: string;
};

export type ExceptionRangeResult = {
  absentees: AbsenteeCandidate[];
  halfDayCandidates: HalfDayCandidate[];
  startDate: string;
  endDate: string;
};

type EmployeeRow = {
  id: string;
  employee_code: string;
  full_name: string;
  department: string;
  office: string;
  employment_status: string;
};

type AttendanceRow = {
  employee_code: string;
  date?: string;
  office_code: string;
  in_time: string | null;
  out_time: string | null;
  duration: string | null;
  status: string | null;
  punch_count: number | null;
};

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolves what "today" should mean for this feature. This app's
 * attendance_records are populated by batch CSV upload (see
 * uploaded_months/lib/parseCSV.ts) — there is no live punch feed — so
 * the calendar date returned by `new Date()` essentially never has a
 * matching row once you're testing/demoing against last month's export.
 * The Dashboard itself never assumes "today" for this reason; it always
 * works off whichever month/date was actually uploaded. This does the
 * same: default to the latest date that actually exists in
 * attendance_records, and only fall back to the real calendar date if
 * the table is empty.
 */
async function resolveDefaultDate(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase
    .from('attendance_records')
    .select('date')
    .order('date', { ascending: false })
    .limit(1);
  return data?.[0]?.date ?? toYMD(new Date());
}

/**
 * Classifies one employee, for one date, into absentee / half-day-candidate
 * / neither. Shared by both the single-date and range queries so they can
 * never disagree about the same day for the same employee. Excludes every
 * edge case the requirement calls out — see getAttendanceExceptions below
 * for the full list (weekly-off, holiday, approved leave, WFH/travel,
 * no-punch-data, already-resolved — those are filtered by the caller
 * BEFORE this runs; this only decides absent vs half-day vs fine).
 */
function classifyEmployeeDay(
  emp: EmployeeRow,
  date: string,
  rec: AttendanceRow | undefined
): { kind: 'absent'; row: AbsenteeCandidate } | { kind: 'half_day'; row: HalfDayCandidate } | null {
  if (!rec) return null; // no punch data uploaded for this date yet — nothing to act on
  if (isWeeklyOff(rec.status ?? '')) return null;

  const workedMinutes = durationToMinutes(rec.duration ?? '');

  if (isMissedPunchOut(rec.status ?? '')) {
    return {
      kind: 'half_day',
      row: {
        employeeId: emp.id,
        employeeCode: emp.employee_code,
        employeeName: emp.full_name,
        department: emp.department,
        office: emp.office,
        workingHours: rec.duration ?? '--',
        firstPunch: rec.in_time ?? null,
        lastPunch: rec.out_time ?? null,
        reason: 'Missed punch (out)',
        status: rec.status ?? '',
        date,
      },
    };
  }

  if (isAbsent(rec.status ?? '')) {
    // Full absence with genuinely no punches at all stays a straight
    // absentee — half-day review only applies when there WAS some
    // punch activity (first punch to last punch) to evaluate.
    //
    // IMPORTANT: this must use the same punch-validity check the CSV
    // importer uses (isPunchTimeValid), not a plain truthiness test on
    // rec.in_time/out_time. The importer stores whatever raw string was
    // in the CSV's in/out columns — for a genuinely absent row that's
    // often a placeholder like "0:00", "--", or "-", not an empty string
    // (lib/storage.ts only nulls out a truly empty string). A naive
    // `!rec.in_time` check treats "0:00" as truthy ("there's a punch"),
    // which was silently reclassifying almost every real absence as a
    // half-day "only one punch recorded" candidate — that's why the
    // Dashboard's absent count and the Leave Tracker's Absentees count
    // could disagree so drastically for the same employee/period.
    const hasInPunch = isPunchTimeValid(rec.in_time ?? '');
    const hasOutPunch = isPunchTimeValid(rec.out_time ?? '');
    if (!hasInPunch && !hasOutPunch) {
      return {
        kind: 'absent',
        row: {
          employeeId: emp.id,
          employeeCode: emp.employee_code,
          employeeName: emp.full_name,
          department: emp.department,
          office: emp.office,
          workingHours: rec.duration ?? '0:00',
          status: rec.status ?? 'Absent',
          date,
        },
      };
    }
    return {
      kind: 'half_day',
      row: {
        employeeId: emp.id,
        employeeCode: emp.employee_code,
        employeeName: emp.full_name,
        department: emp.department,
        office: emp.office,
        workingHours: rec.duration ?? '--',
        firstPunch: rec.in_time ?? null,
        lastPunch: rec.out_time ?? null,
        reason: 'Only one punch recorded',
        status: rec.status ?? '',
        date,
      },
    };
  }

  if (isPresent(rec.status ?? '') && workedMinutes > 0 && workedMinutes <= HALF_DAY_THRESHOLD_MINUTES) {
    return {
      kind: 'half_day',
      row: {
        employeeId: emp.id,
        employeeCode: emp.employee_code,
        employeeName: emp.full_name,
        department: emp.department,
        office: emp.office,
        workingHours: rec.duration ?? '--',
        firstPunch: rec.in_time ?? null,
        lastPunch: rec.out_time ?? null,
        reason: 'First-to-last punch under 5 hours',
        status: rec.status ?? '',
        date,
      },
    };
  }

  return null;
}

function buildHolidayLookup(
  employees: EmployeeRow[],
  years: string[],
  customHolidays: { office_code: string; date: string }[]
): Map<string, Set<string>> {
  const offices = new Set(employees.map((e) => e.office));
  const holidayDatesByOffice = new Map<string, Set<string>>();
  for (const office of offices) {
    const dates = new Set<string>();
    for (const year of years) {
      for (const h of getPredefinedHolidays(office, year)) dates.add(h.date);
    }
    for (const h of customHolidays) {
      if (h.office_code === office) dates.add(h.date);
    }
    holidayDatesByOffice.set(office, dates);
  }
  return holidayDatesByOffice;
}

/**
 * Computes today's (or a given date's) absentee list and possible-half-day/
 * missed-punch list, excluding every edge case the requirement calls out:
 *   - Weekend / weekly-off (isWeeklyOff — already handles "WeeklyOff Present")
 *   - Holiday (office + year predefined list + custom_holidays)
 *   - Already-approved leave for that date (leave_requests, status='approved',
 *     start_date <= date <= end_date)
 *   - Work From Home / Business Travel / Remote / Flexible Shift
 *     (workforce_events — wfh/business_travel; office_shutdown excludes the
 *     whole office for the day)
 *   - No attendance_records row at all for that employee+date (no punch
 *     uploaded yet) — not shown as absent; there's nothing to act on until
 *     a CSV exists for that day.
 *   - Already resolved today (attendance_exceptions.resolution != 'pending')
 *     — HR already ignored/actioned this employee for this date.
 * Single Punch / Only Punch In / Only Punch Out / Duplicate Punches / Night
 * Shift are surfaced through the underlying status string and
 * isMissedPunchOut() classification rather than re-parsed here — the CSV
 * import pipeline (lib/parseCSV.ts) already normalizes punch_count and
 * in/out times for those cases before they ever reach attendance_records.
 */
export async function getAttendanceExceptions(
  supabase: SupabaseClient,
  dateOverride?: string
): Promise<ExceptionResult> {
  const date = dateOverride ?? (await resolveDefaultDate(supabase));
  const year = date.slice(0, 4);

  const [
    { data: employees, error: employeesError },
    { data: attendanceRows, error: attendanceError },
    { data: approvedLeave, error: leaveError },
    { data: workforceEvents, error: eventsError },
    { data: customHolidays, error: holidaysError },
    { data: resolved, error: resolvedError },
  ] = await Promise.all([
    supabase
      .from('employees')
      .select('id, employee_code, full_name, department, office, employment_status')
      .neq('employment_status', 'exited'),
    supabase
      .from('attendance_records')
      .select('employee_code, office_code, in_time, out_time, duration, status, punch_count')
      .eq('date', date),
    supabase
      .from('leave_requests')
      .select('employee_id, start_date, end_date')
      .eq('status', 'approved')
      .lte('start_date', date)
      .gte('end_date', date),
    supabase
      .from('workforce_events')
      .select('employee_id, event_type')
      .eq('event_date', date),
    supabase.from('custom_holidays').select('office_code, date, name').eq('year', year),
    supabase.from('attendance_exceptions').select('employee_id').eq('exception_date', date).neq('resolution', 'pending'),
  ]);

  const firstError = employeesError || attendanceError || leaveError || eventsError || holidaysError || resolvedError;
  if (firstError) {
    throw new Error(firstError.message);
  }

  const attendanceByCode = new Map((attendanceRows ?? []).map((r) => [r.employee_code, r as AttendanceRow]));
  const onApprovedLeave = new Set((approvedLeave ?? []).map((r) => r.employee_id));
  const exemptEmployeeIds = new Set((workforceEvents ?? []).map((e) => e.employee_id));
  const alreadyResolved = new Set((resolved ?? []).map((r) => r.employee_id));
  const holidayDatesByOffice = buildHolidayLookup((employees ?? []) as EmployeeRow[], [year], customHolidays ?? []);

  const absentees: AbsenteeCandidate[] = [];
  const halfDayCandidates: HalfDayCandidate[] = [];

  for (const emp of (employees ?? []) as EmployeeRow[]) {
    if (alreadyResolved.has(emp.id)) continue;
    if (onApprovedLeave.has(emp.id)) continue;
    if (exemptEmployeeIds.has(emp.id)) continue;
    if (holidayDatesByOffice.get(emp.office)?.has(date)) continue;

    const result = classifyEmployeeDay(emp, date, attendanceByCode.get(emp.employee_code));
    if (!result) continue;
    if (result.kind === 'absent') absentees.push(result.row);
    else halfDayCandidates.push(result.row);
  }

  return { absentees, halfDayCandidates, date };
}

/**
 * Used when the Leave Tracker first loads and HR hasn't picked a date
 * yet. The old behavior defaulted to just the single latest uploaded
 * date (resolveDefaultDate) — but the whole point of the Absentees/Half
 * Days tabs is "everything HR hasn't marked yet" (once HR records a
 * leave for a row, it drops out here and shows up in Leave History
 * instead — see attendance_exceptions.resolution above). Limiting that
 * to one day meant the vast majority of unresolved rows across the
 * uploaded months were invisible until HR happened to pick a wide date
 * range manually. This instead spans the full range of uploaded
 * attendance data and reuses getAttendanceExceptionsRange (one batch of
 * queries, not one per day) so the default view really is "everything
 * pending," full stop.
 */
export async function getAttendanceExceptionsAllPending(
  supabase: SupabaseClient
): Promise<ExceptionRangeResult> {
  const [{ data: earliestRow }, latestDate] = await Promise.all([
    supabase.from('attendance_records').select('date').order('date', { ascending: true }).limit(1),
    resolveDefaultDate(supabase),
  ]);
  const earliestDate = earliestRow?.[0]?.date;
  if (!earliestDate) {
    // No attendance data uploaded at all yet — nothing to show.
    return { absentees: [], halfDayCandidates: [], startDate: latestDate, endDate: latestDate };
  }
  return getAttendanceExceptionsRange(supabase, earliestDate, latestDate);
}

/**
 * Same classification as getAttendanceExceptions, but for a whole
 * start_date..end_date period in one batch of queries instead of one set
 * of queries per day — this is the "from date to to date, overall
 * absentees in that period" view. Every table involved (attendance_records,
 * leave_requests, workforce_events, custom_holidays, attendance_exceptions)
 * is fetched once for the full range, then classified day-by-day in memory,
 * so a wide range costs one round trip per table, not one per day.
 */
export async function getAttendanceExceptionsRange(
  supabase: SupabaseClient,
  rangeStart: string,
  rangeEnd: string
): Promise<ExceptionRangeResult> {
  const startDate = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
  const endDate = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
  const startYear = startDate.slice(0, 4);
  const endYear = endDate.slice(0, 4);
  const years = Array.from(
    { length: Number(endYear) - Number(startYear) + 1 },
    (_, i) => String(Number(startYear) + i)
  );

  const [
    { data: employees, error: employeesError },
    { data: attendanceRows, error: attendanceError },
    { data: approvedLeave, error: leaveError },
    { data: workforceEvents, error: eventsError },
    { data: customHolidays, error: holidaysError },
    { data: resolved, error: resolvedError },
  ] = await Promise.all([
    supabase
      .from('employees')
      .select('id, employee_code, full_name, department, office, employment_status')
      .neq('employment_status', 'exited'),
    supabase
      .from('attendance_records')
      .select('employee_code, date, office_code, in_time, out_time, duration, status, punch_count')
      .gte('date', startDate)
      .lte('date', endDate),
    // Leave overlapping the range (not just leave fully inside it) — a
    // request that started before the range and ends inside it (or vice
    // versa) should still exempt the in-range days it covers.
    supabase
      .from('leave_requests')
      .select('employee_id, start_date, end_date')
      .eq('status', 'approved')
      .lte('start_date', endDate)
      .gte('end_date', startDate),
    supabase
      .from('workforce_events')
      .select('employee_id, event_type, event_date')
      .gte('event_date', startDate)
      .lte('event_date', endDate),
    supabase.from('custom_holidays').select('office_code, date, name').in('year', years),
    supabase
      .from('attendance_exceptions')
      .select('employee_id, exception_date')
      .gte('exception_date', startDate)
      .lte('exception_date', endDate)
      .neq('resolution', 'pending'),
  ]);

  const firstError = employeesError || attendanceError || leaveError || eventsError || holidaysError || resolvedError;
  if (firstError) {
    throw new Error(firstError.message);
  }

  const employeesList = (employees ?? []) as EmployeeRow[];
  const holidayDatesByOffice = buildHolidayLookup(employeesList, years, customHolidays ?? []);

  // Group per-day lookups once, then walk each date in the range using
  // plain map reads — O(days × employees) in memory, zero extra round
  // trips regardless of how wide the range is.
  const attendanceByDateAndCode = new Map<string, Map<string, AttendanceRow>>();
  for (const r of (attendanceRows ?? []) as Required<AttendanceRow>[]) {
    const byCode = attendanceByDateAndCode.get(r.date) ?? new Map<string, AttendanceRow>();
    byCode.set(r.employee_code, r);
    attendanceByDateAndCode.set(r.date, byCode);
  }

  const leaveRangesByEmployee = new Map<string, { start: string; end: string }[]>();
  for (const r of approvedLeave ?? []) {
    const list = leaveRangesByEmployee.get(r.employee_id) ?? [];
    list.push({ start: r.start_date, end: r.end_date });
    leaveRangesByEmployee.set(r.employee_id, list);
  }

  const exemptByDate = new Map<string, Set<string>>();
  for (const e of workforceEvents ?? []) {
    const set = exemptByDate.get(e.event_date) ?? new Set<string>();
    set.add(e.employee_id);
    exemptByDate.set(e.event_date, set);
  }

  const resolvedByDate = new Map<string, Set<string>>();
  for (const r of resolved ?? []) {
    const set = resolvedByDate.get(r.exception_date) ?? new Set<string>();
    set.add(r.employee_id);
    resolvedByDate.set(r.exception_date, set);
  }

  const absentees: AbsenteeCandidate[] = [];
  const halfDayCandidates: HalfDayCandidate[] = [];

  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    const date = toYMD(cursor);
    const attendanceByCode = attendanceByDateAndCode.get(date);
    const exemptToday = exemptByDate.get(date);
    const resolvedToday = resolvedByDate.get(date);

    for (const emp of employeesList) {
      if (resolvedToday?.has(emp.id)) continue;
      if (exemptToday?.has(emp.id)) continue;
      if (holidayDatesByOffice.get(emp.office)?.has(date)) continue;
      const empLeaveRanges = leaveRangesByEmployee.get(emp.id);
      if (empLeaveRanges?.some((l) => l.start <= date && l.end >= date)) continue;

      const result = classifyEmployeeDay(emp, date, attendanceByCode?.get(emp.employee_code));
      if (!result) continue;
      if (result.kind === 'absent') absentees.push(result.row);
      else halfDayCandidates.push(result.row);
    }

    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  // Most-recent-day-first reads better for a multi-day review list than
  // employee-order-within-day.
  absentees.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  halfDayCandidates.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { absentees, halfDayCandidates, startDate, endDate };
}
