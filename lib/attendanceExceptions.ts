import type { SupabaseClient } from '@supabase/supabase-js';
import { durationToMinutes } from './parseCSV';
import { isAbsent, isPresent, isWeeklyOff, isMissedPunchOut } from './useDashboardData';
import { getPredefinedHolidays } from './predefinedHolidays';

// Server-side (Leave Tracker) attendance-exception detection for the
// "Today's Absentees" and "Possible Half Day / Missed Punch" accordions.
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

export type AbsenteeCandidate = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  office: string;
  workingHours: string;
  status: string;
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
};

export type ExceptionResult = {
  absentees: AbsenteeCandidate[];
  halfDayCandidates: HalfDayCandidate[];
  date: string;
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

  const attendanceByCode = new Map((attendanceRows ?? []).map((r) => [r.employee_code, r]));
  const onApprovedLeave = new Set((approvedLeave ?? []).map((r) => r.employee_id));
  // workforce_events rows are per-employee (see unified_schema.sql), so
  // office_shutdown is exempted the same way as wfh/business_travel: it
  // shows up as a row for every employee it applies to, not as a
  // separate per-office lookup.
  const exemptEmployeeIds = new Set((workforceEvents ?? []).map((e) => e.employee_id));
  const alreadyResolved = new Set((resolved ?? []).map((r) => r.employee_id));

  const officeYears = new Set((employees ?? []).map((e) => `${e.office}|${year}`));
  const holidayDatesByOffice = new Map<string, Set<string>>();
  for (const key of officeYears) {
    const [office] = key.split('|');
    const predefined = getPredefinedHolidays(office, year).map((h) => h.date);
    const custom = (customHolidays ?? []).filter((h) => h.office_code === office).map((h) => h.date);
    holidayDatesByOffice.set(office, new Set([...predefined, ...custom]));
  }

  const absentees: AbsenteeCandidate[] = [];
  const halfDayCandidates: HalfDayCandidate[] = [];

  for (const emp of employees ?? []) {
    if (alreadyResolved.has(emp.id)) continue;
    if (onApprovedLeave.has(emp.id)) continue;
    if (exemptEmployeeIds.has(emp.id)) continue;
    if (holidayDatesByOffice.get(emp.office)?.has(date)) continue;

    const rec = attendanceByCode.get(emp.employee_code);
    if (!rec) continue; // no punch data uploaded for this date yet — nothing to act on

    if (isWeeklyOff(rec.status ?? '')) continue;

    const workedMinutes = durationToMinutes(rec.duration ?? '');

    if (isMissedPunchOut(rec.status ?? '')) {
      halfDayCandidates.push({
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
      });
      continue;
    }

    if (isAbsent(rec.status ?? '')) {
      // Full absence with genuinely no punches at all stays a straight
      // absentee — half-day review only applies when there WAS some
      // punch activity (first punch to last punch) to evaluate.
      if (!rec.in_time && !rec.out_time) {
        absentees.push({
          employeeId: emp.id,
          employeeCode: emp.employee_code,
          employeeName: emp.full_name,
          department: emp.department,
          office: emp.office,
          workingHours: rec.duration ?? '0:00',
          status: rec.status ?? 'Absent',
        });
      } else {
        halfDayCandidates.push({
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
        });
      }
      continue;
    }

    if (isPresent(rec.status ?? '') && workedMinutes > 0 && workedMinutes <= HALF_DAY_THRESHOLD_MINUTES) {
      halfDayCandidates.push({
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
      });
    }
  }

  return { absentees, halfDayCandidates, date };
}