import type { SupabaseClient } from '@supabase/supabase-js';
import { getPredefinedHolidays } from './predefinedHolidays';

// Every check in this module is a plain, importable function — no route
// logic lives here. Per the Leave Policy implementation prompt (section 0):
// the only live leave-insertion path today is
// app/api/leave/employees/requests/route.ts, but a future employee
// self-apply route and manager-approval route will need to run the exact
// same policy checks without duplicating them. Same reasoning as why
// fn_check_planned_leave_notice was written as a standalone RPC rather
// than inlined into the route.

export function addMonths(dateStr: string, months: number): Date {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

// ---------------------------------------------------------------------
// 2b — probation-period leave (any type, not just PL) before the
// month-4 unlock. Auto-LWP at recording time; submission is never
// blocked.
// ---------------------------------------------------------------------
export function getProbationLwpReason(
  dateOfJoining: string,
  requestStartDate: string,
  // Configurable via leave_policy_config.probation_unlock_months (HR's
  // new Leave Configuration page — item #3 of the Aug 2026 feedback
  // batch). Defaults to the original hardcoded value of 4 so any caller
  // that hasn't been updated to fetch config yet keeps the old behavior.
  unlockMonths: number = 4
): string | null {
  const unlockDate = addMonths(dateOfJoining, unlockMonths);
  const start = new Date(`${requestStartDate}T00:00:00Z`);
  if (start < unlockDate) {
    return 'Leave during probation period (before month-4 unlock)';
  }
  return null;
}

// ---------------------------------------------------------------------
// 2c — notice-period leave. Auto-LWP at recording time; no schema
// changes, no last-working-day extension logic (HR does that by hand
// outside this system, per the finalized decision).
// ---------------------------------------------------------------------
export function getNoticePeriodLwpReason(
  employmentStatus: string,
  dateOfExit: string | null,
  noticePeriodDays: number | null,
  requestStartDate: string
): string | null {
  if (employmentStatus !== 'notice_period') return null;

  const start = new Date(`${requestStartDate}T00:00:00Z`);

  // date_of_exit not set yet but status is already notice_period: every
  // date from today onward is treated as in-window.
  if (!dateOfExit) {
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    if (start >= today) return 'Leave during notice period';
    return null;
  }

  const exit = new Date(`${dateOfExit}T00:00:00Z`);
  const days = noticePeriodDays ?? 30;
  const windowStart = new Date(exit);
  windowStart.setUTCDate(windowStart.getUTCDate() - days);

  if (start >= windowStart) return 'Leave during notice period';
  return null;
}

export interface EmployeeForConversionCheck {
  date_of_joining: string;
  employment_status: string;
  date_of_exit: string | null;
  notice_period_days: number | null;
}

// Ordering per 2b: probation is checked first; notice-period only
// applies if probation doesn't already trigger (an employee can't
// realistically be both, but probation is the more specific/earlier
// condition so it takes priority if both were somehow true).
export function getAutoLwpConversionReason(
  employee: EmployeeForConversionCheck,
  requestStartDate: string,
  // See getProbationLwpReason's comment — sourced from
  // leave_policy_config by callers that have a Supabase client handy
  // (applyLeavePolicyAndMutateBalance.ts); pure callers can omit it and
  // get the original default.
  unlockMonths: number = 4
): string | null {
  const probationReason = getProbationLwpReason(employee.date_of_joining, requestStartDate, unlockMonths);
  if (probationReason) return probationReason;
  return getNoticePeriodLwpReason(
    employee.employment_status,
    employee.date_of_exit,
    employee.notice_period_days,
    requestStartDate
  );
}

// ---------------------------------------------------------------------
// 2a — combining-leaves adjacency. Advisory only — flags, never blocks
// or auto-converts. Only different-leave-type adjacency triggers this;
// a single request bridging a weekend/holiday with nothing on the other
// side is never flagged (no standalone "bridges a holiday" check).
// ---------------------------------------------------------------------

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function holidaySetForYears(office: string, startYear: number, endYear: number): Set<string> {
  const set = new Set<string>();
  for (let y = startYear; y <= endYear; y++) {
    for (const h of getPredefinedHolidays(office, y)) set.add(h.date);
  }
  return set;
}

// True if every day strictly between earlierEnd and laterStart is a
// weekend or a predefined holiday — i.e. zero working days in the gap.
// Adjacent with a zero-day gap (laterStart is the very next calendar day
// after earlierEnd) also returns true, since the loop simply never runs.
function onlyNonWorkingDaysBetween(office: string, earlierEnd: string, laterStart: string): boolean {
  const start = new Date(`${earlierEnd}T00:00:00Z`);
  const end = new Date(`${laterStart}T00:00:00Z`);
  const holidays = holidaySetForYears(office, start.getUTCFullYear(), end.getUTCFullYear());

  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor < end) {
    const ymd = cursor.toISOString().slice(0, 10);
    if (!isWeekend(cursor) && !holidays.has(ymd)) return false;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return true;
}

type OtherLeaveRow = {
  start_date: string;
  end_date: string;
  leave_types: { code: string } | { code: string }[] | null;
};

function otherRowCode(row: OtherLeaveRow): string | null {
  const lt = row.leave_types;
  if (!lt) return null;
  return Array.isArray(lt) ? lt[0]?.code ?? null : lt.code ?? null;
}

/**
 * Checks whether newStartDate..newEndDate is adjacent (zero working days
 * of gap) to any pending/approved leave_requests row for the same
 * employee of a DIFFERENT leave_type_code. Returns an advisory note
 * string, or null if nothing to flag. Call this with the employee's
 * ORIGINALLY requested leave type code — even if that request is then
 * auto-converted to LWP by 2b/2c, adjacency is still evaluated against
 * what was actually requested (per section 2b's ordering note).
 */
export async function checkCombiningLeaves(
  supabase: SupabaseClient,
  employeeId: string,
  employeeOffice: string,
  newRequestTypeCode: string,
  newStartDate: string,
  newEndDate: string
): Promise<string | null> {
  const { data: rows, error } = await supabase
    .from('leave_requests')
    .select('start_date, end_date, status, leave_types ( code )')
    .eq('employee_id', employeeId)
    .in('status', ['pending', 'approved']);

  if (error || !rows) return null;

  for (const row of rows as unknown as OtherLeaveRow[]) {
    const otherCode = otherRowCode(row);
    if (!otherCode || otherCode === newRequestTypeCode) continue;

    let earlierEnd: string;
    let laterStart: string;
    if (row.end_date < newStartDate) {
      earlierEnd = row.end_date;
      laterStart = newStartDate;
    } else if (newEndDate < row.start_date) {
      earlierEnd = newEndDate;
      laterStart = row.start_date;
    } else {
      // Overlapping ranges — not an adjacency case.
      continue;
    }

    if (onlyNonWorkingDaysBetween(employeeOffice, earlierEnd, laterStart)) {
      return `Adjacent to an existing ${otherCode} request (${row.start_date} → ${row.end_date}) with only weekends/holidays in between — different leave types being combined across a weekend/holiday; HR/manager should confirm proof was given.`;
    }
  }

  return null;
}
