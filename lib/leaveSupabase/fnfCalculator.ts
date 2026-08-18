import type { SupabaseClient } from '@supabase/supabase-js';
import { getFYStartYear } from './fyHelpers';

// F&F (Full & Final) Calculator — pure calc functions, no route logic
// here. Same reasoning as leavePolicy.ts's header comment: the only
// caller today is app/api/leave/admin/fnf/route.ts, but a future bulk
// F&F export/report should be able to reuse this exact math without
// re-deriving it.

const CYCLE_CUTOFF_DAY = 25; // salary cycle: 25th of month N -> 24th of month N+1

/** Whole months from FY start (25-Mar, clamped to date_of_joining if later) to LWD. */
export function monthsServedInFY(dateOfJoining: string, lwd: string, fyStartYear: number): number {
  const fyStart = new Date(Date.UTC(fyStartYear, 2, 25)); // month is 0-indexed: 2 = March
  const doj = new Date(`${dateOfJoining}T00:00:00Z`);
  const effectiveStart = doj > fyStart ? doj : fyStart;
  const end = new Date(`${lwd}T00:00:00Z`);

  if (end < effectiveStart) return 0;

  let months =
    (end.getUTCFullYear() - effectiveStart.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - effectiveStart.getUTCMonth());
  // Whole-month granularity — same rule fn_prorate_new_joiner uses on
  // the joining side, just run in reverse.
  if (end.getUTCDate() < effectiveStart.getUTCDate()) months -= 1;

  return Math.max(months, 0);
}

/** The 25th that starts the salary cycle containing this date. */
export function cycleStartFor(dateStr: string): Date {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const start = new Date(d);
  if (d.getUTCDate() <= 24) {
    start.setUTCMonth(start.getUTCMonth() - 1);
  }
  start.setUTCDate(CYCLE_CUTOFF_DAY);
  return start;
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PayableDaysResult {
  cycleStart: string;
  grossDays: number;
  lwpDays: number;
  payableDays: number;
}

export function computePayableDays(lwd: string, lwpDaysInWindow: number): PayableDaysResult {
  const cycleStart = cycleStartFor(lwd);
  const end = new Date(`${lwd}T00:00:00Z`);
  const grossDays = Math.round((end.getTime() - cycleStart.getTime()) / 86400000) + 1;
  return {
    cycleStart: toISODate(cycleStart),
    grossDays,
    lwpDays: lwpDaysInWindow,
    payableDays: Math.max(grossDays - lwpDaysInWindow, 0),
  };
}

export interface PayableLeavesResult {
  monthsServed: number;
  monthlyRate: number;
  entitlement: number;
  leaveUsedThisFY: number;
  payableLeaves: number;
}

export function computePayableLeaves(
  monthsServed: number,
  totalAnnualQuota: number, // sum of SL+CL+PL annual_quota, e.g. 21 -> 1.75/mo
  leaveUsedThisFY: number
): PayableLeavesResult {
  const monthlyRate = totalAnnualQuota / 12;
  const entitlement = round2(monthsServed * monthlyRate);
  const payableLeaves = Math.max(round2(entitlement - leaveUsedThisFY), 0);
  return { monthsServed, monthlyRate, entitlement, leaveUsedThisFY, payableLeaves };
}

// ---------------------------------------------------------------------
// Orchestrator — pulls the Supabase data and calls the pure functions
// above. Called by the API route; kept here (not inline in the route)
// so a future bulk-F&F job can call the same function.
// ---------------------------------------------------------------------
export interface FnFCalculation {
  employeeId: string;
  lastWorkingDay: string;
  fyStartYear: number;
  days: PayableDaysResult;
  leaves: PayableLeavesResult;
}

export async function calculateFnF(
  supabase: SupabaseClient,
  employeeId: string,
  lastWorkingDay: string
): Promise<{ result: FnFCalculation | null; error: string | null }> {
  const { data: employee, error: empErr } = await supabase
    .from('employees')
    .select('id, date_of_joining')
    .eq('id', employeeId)
    .maybeSingle();
  if (empErr) return { result: null, error: empErr.message };
  if (!employee) return { result: null, error: 'Employee not found.' };

  const fyStartYear = getFYStartYear(new Date(`${lastWorkingDay}T00:00:00Z`));
  const monthsServed = monthsServedInFY(employee.date_of_joining, lastWorkingDay, fyStartYear);

  // Total annual quota = sum of SL+CL+PL (excludes LWP, which is 0/derived-only).
  const { data: leaveTypes, error: ltErr } = await supabase
    .from('leave_types')
    .select('id, code, annual_quota')
    .neq('code', 'LWP');
  if (ltErr) return { result: null, error: ltErr.message };
  const totalAnnualQuota = (leaveTypes ?? []).reduce((sum, t) => sum + Number(t.annual_quota), 0);

  // Leave used this FY across SL+CL+PL. leave_balances.used is already
  // the running total the approval/cancellation flow maintains (see
  // applyLeavePolicyAndMutateBalance.ts) — read it directly rather than
  // re-summing leave_requests.
  const { data: balances, error: balErr } = await supabase
    .from('leave_balances')
    .select('used, leave_types!inner ( code )')
    .eq('employee_id', employeeId)
    .eq('fy_start_year', fyStartYear)
    .neq('leave_types.code', 'LWP');
  if (balErr) return { result: null, error: balErr.message };
  const leaveUsedThisFY = (balances ?? []).reduce((sum, b) => sum + Number(b.used), 0);

  const leaves = computePayableLeaves(monthsServed, totalAnnualQuota, leaveUsedThisFY);

  // LWP days already recorded inside the final (partial) salary cycle —
  // net these off the gross cycle length. Auto-LWP conversions write
  // leave_type_id = LWP's id and status = 'approved' (see
  // applyLeavePolicyAndMutateBalance.ts lines ~200/552/624), so a plain
  // leave_types.code = 'LWP' + status = 'approved' filter catches both
  // manually-requested LWP and policy-engine auto-conversions.
  const cycleStartISO = toISODate(cycleStartFor(lastWorkingDay));
  const { data: lwpRows, error: lwpErr } = await supabase
    .from('leave_requests')
    .select('total_days, start_date, end_date, leave_types!inner ( code )')
    .eq('employee_id', employeeId)
    .eq('leave_types.code', 'LWP')
    .eq('status', 'approved')
    .lte('start_date', lastWorkingDay)
    .gte('end_date', cycleStartISO);
  if (lwpErr) return { result: null, error: lwpErr.message };
  const lwpDaysInWindow = (lwpRows ?? []).reduce((sum, r) => sum + Number(r.total_days), 0);

  const days = computePayableDays(lastWorkingDay, lwpDaysInWindow);

  return { result: { employeeId, lastWorkingDay, fyStartYear, days, leaves }, error: null };
}
