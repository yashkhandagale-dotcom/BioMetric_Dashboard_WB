import type { SupabaseClient } from '@supabase/supabase-js';
import { createLeaveServiceClient } from './server';
import { TrackerLeaveTypeCode } from './leaveTypeMap';
import { checkCombiningLeaves, getAutoLwpConversionReason, EmployeeForConversionCheck } from '../leavePolicy';
import { getLeavePolicyConfig } from './leaveConfig';
import { notifyLeaveEvent as notifyLeaveEventReal } from './notifyLeaveEvent';
import { getEmployeeBalancesByFY } from './getEmployeeBalances';
import { reconcileLeaveRequestAgainstAttendance } from './reconcileLeaveAttendance';

// =====================================================================
// applyLeavePolicyAndMutateBalance
//
// The ONLY function allowed to write to leave_balances,
// balance_transactions, or leave_requests going forward (see the
// "Design invariants" header of supabase-leave/schema.sql and this
// workstream's PROGRESS.md entry for why). Runs the shared policy engine
// (lib/leavePolicy.ts), creates/updates the leave_requests row, and
// writes the matching balance_transactions row for approve/cancel.
//
// Read supabase-leave/schema.sql and lib/leavePolicy.ts fully before
// touching this file — in particular:
//   - leave_requests.source only allows ('employee_apply', 'hr_manual')
//     at the DB level (schema.sql:154-155). The four app-level `source`
//     values below are a richer vocabulary for CALLERS of this function
//     (self_apply vs. manager_approval both originate an employee's own
//     request; cancellation acts on an existing row rather than
//     creating one) — dbSourceFor() below maps them onto the two values
//     the check constraint actually accepts. Do not widen that DB
//     constraint to match this vocabulary without also revisiting every
//     other place that reads leave_requests.source.
//   - fn_debit_leave_on_approval (schema.sql §6) is only ever called
//     once a row's status is 'approved' — a 'pending' self_apply row is
//     therefore NOT debited at creation time, only when a later
//     manager_approval call flips it to 'approved'.
//   - There is no SQL function for reversing a debit on cancellation —
//     'leave_cancelled' is a valid balance_transactions.reason (schema
//     line 110) but nothing in schema.sql writes it. The cancellation
//     branch below does the credit-back directly against
//     leave_balances/balance_transactions, mirroring exactly what
//     fn_debit_leave_on_approval does in the opposite direction (same
//     FY-boundary rule, same tables), since inventing a new SQL RPC
//     wasn't in scope for this prompt.
// =====================================================================

export type ApplyLeaveSource = 'self_apply' | 'manager_approval' | 'manager_reject' | 'hr_manual' | 'cancellation' | 'hr_correction';

export interface DayBreakdownItem {
  date: string;
  isHalfDay: boolean;
  session?: 'AM' | 'PM';
}

export interface ApplyLeavePolicyAndMutateBalanceParams {
  employeeId: string;
  leaveTypeCode: TrackerLeaveTypeCode;
  startDate: string;
  // null/omitted collapses to startDate — mirrors the existing route's
  // "half day is always a single date" handling.
  endDate?: string | null;
  isHalfDay: boolean;
  halfDaySession?: 'AM' | 'PM';
  totalDays?: number;
  dayBreakdown?: DayBreakdownItem[];
  reason: string;
  actionPlan?: string;
  source: ApplyLeaveSource;

  // --- Additive params not in the prompt's literal signature ---------
  // manager_approval and cancellation act on an EXISTING leave_requests
  // row — there is no schema-legal way to "approve" or "cancel" a
  // request without knowing which one, so this is required for those
  // two sources (self_apply/hr_manual ignore it; they always create).
  existingRequestId?: string;
  // The employees.id of whoever is performing this action — used for
  // the approval_steps audit row. Optional: when omitted, the audit row
  // is skipped, exactly like the pre-existing hr_manual route already
  // does when it can't resolve an hrEmployeeId (see its own comment on
  // that fallback, carried over unchanged).
  actingEmployeeId?: string | null;
  // Defaults to 'hr' for hr_manual and 'manager' for manager_approval —
  // override if a lead-level approval needs to be recorded instead.
  approverRole?: 'lead' | 'manager' | 'hr';
  // manager_reject only — the manager's short comment, required by the
  // approvals-queue UI (see components/leave/ApprovalCard.tsx) and
  // surfaced verbatim to the employee via notifyLeaveEvent.
  rejectionComment?: string;
  // hr_correction only — required. Why HR is reversing an already-
  // approved/auto_lwp request after the fact (typically after its dates
  // have already passed, which is exactly why this isn't routed through
  // 'cancellation' — see hrCorrectExistingRequest's own header comment).
  correctionReason?: string;
}

export interface ApplyLeavePolicyAndMutateBalanceResult {
  // null only on a hard failure where no row was persisted (or, for
  // manager_approval/cancellation, when existingRequestId itself
  // couldn't be resolved) — see each violation `type` for which case.
  requestId: string | null;
  violation?: { type: string; reason: string };
  convertedToLwp: boolean;
  policyNotes: string[];
  totalDays: number;
  // Full leave_requests row as persisted (post any LWP conversion) —
  // callers like the hr_manual route reconstruct their exact prior JSON
  // response from this rather than this function assuming a response
  // shape that belongs to one specific caller.
  leaveRequest: Record<string, any> | null;
}

type LeaveTypeRow = { id: string; code: string; requires_certificate_after_days: number | null };

// ---------------------------------------------------------------------
// Small local helpers — kept in this file rather than imported, see
// inline notes on each for why.
// ---------------------------------------------------------------------

function daysBetweenInclusive(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

// Same 25-Mar FY-cutover rule as fn_prorate_new_joiner / fn_debit_leave_
// on_approval in supabase-leave/schema.sql (month > 3, or month = 3 and
// day >= 25) and lib/leaveSupabase/fyHelpers.ts's getFYStartYear —
// re-implemented on the raw 'YYYY-MM-DD' string rather than a JS Date so
// there's no local-timezone ambiguity around the exact midnight cutover
// (getFYStartYear takes a Date and reads it in local time, which is fine
// for "what FY is today" but risky for a fixed calendar date like a
// leave's start_date that must match the DB function's date-only math
// exactly).
function fyStartYearForDate(dateStr: string): number {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const isBeforeCycleStart = month < 3 || (month === 3 && day < 25);
  return isBeforeCycleStart ? year - 1 : year;
}

// Maps the app-level source vocabulary onto the two values
// leave_requests.source actually allows at the DB level. See the file
// header comment for why these two aren't 1:1.
function dbSourceFor(source: ApplyLeaveSource): 'employee_apply' | 'hr_manual' {
  return source === 'hr_manual' ? 'hr_manual' : 'employee_apply';
}

// ---------------------------------------------------------------------
// notifyLeaveEvent — now a real implementation (lib/leaveSupabase/
// notifyLeaveEvent.ts), replacing the no-op stub that used to live here
// (see PROGRESS.md's "notifyLeaveEvent() — Part 3 doesn't exist in this
// codebase yet" entry for the original reasoning). Thin local wrapper so
// every call site below — which already passes event/requestId/
// employeeId/source — didn't need to change shape, just gains a few more
// (optional) fields the real fan-out logic needs to pick wide vs narrow
// broadcast scope.
// ---------------------------------------------------------------------
interface LeaveEvent {
  type: 'submitted' | 'approved' | 'rejected' | 'cancelled' | 'corrected';
  requestId: string;
  employeeId: string;
  source: ApplyLeaveSource;
  convertedToLwp?: boolean;
  leaveTypeCode?: TrackerLeaveTypeCode;
  isHalfDay?: boolean;
  startDate?: string;
  endDate?: string;
  rejectionComment?: string;
  violationNote?: string | null;
  correctionReason?: string;
}
async function notifyLeaveEvent(service: SupabaseClient, event: LeaveEvent): Promise<void> {
  await notifyLeaveEventReal(service, event);
}

// ---------------------------------------------------------------------
// Shared debit helper — the "debit, and if the balance is insufficient
// fall back to LWP" logic that both the hr_manual create path and the
// manager_approval path need. Previously only lived inline in
// app/api/leave/employees/requests/route.ts; centralizing it here means
// manager_approval doesn't have to duplicate it once that route exists.
// ---------------------------------------------------------------------
async function debitWithLwpFallback(
  service: SupabaseClient,
  leaveRequestId: string,
  currentLeaveType: LeaveTypeRow
): Promise<{
  error: { message: string } | null;
  convertedToLwp: boolean;
  finalLeaveType?: LeaveTypeRow;
  note?: string;
}> {
  const { error: debitError } = await service.rpc('fn_debit_leave_on_approval', {
    p_leave_request_id: leaveRequestId,
  });
  if (!debitError) return { error: null, convertedToLwp: false };
  if (currentLeaveType.code === 'LWP') return { error: debitError, convertedToLwp: false };

  const { data: lwpType, error: lwpError } = await service
    .from('leave_types')
    .select('id, code, requires_certificate_after_days')
    .eq('code', 'LWP')
    .single();
  if (lwpError || !lwpType) return { error: debitError, convertedToLwp: false };

  const { error: retypeError } = await service
    .from('leave_requests')
    .update({
      leave_type_id: lwpType.id,
      is_lwp_override: true,
      lwp_override_reason: `Insufficient ${currentLeaveType.code} balance at time of recording — auto-converted to LWP.`,
    })
    .eq('id', leaveRequestId);
  if (retypeError) return { error: debitError, convertedToLwp: false };

  const retry = await service.rpc('fn_debit_leave_on_approval', { p_leave_request_id: leaveRequestId });
  if (retry.error) return { error: retry.error, convertedToLwp: false };

  return {
    error: null,
    convertedToLwp: true,
    finalLeaveType: lwpType as LeaveTypeRow,
    note: `Insufficient ${currentLeaveType.code} balance — recorded as LWP instead.`,
  };
}

// ---------------------------------------------------------------------
// previewLeavePolicy — dry run of the exact checks createAndMaybeApprove
// runs (SL certificate note, PL notice-tier shortfall, combining-leaves
// adjacency, probation/notice-period auto-LWP, and — new here — a
// balance-sufficiency check that createAndMaybeApprove itself doesn't
// need, since self_apply doesn't debit until manager_approval anyway).
// Writes nothing. Built so the apply form can show the same warnings the
// employee would get back after submitting, while they're still filling
// the form — same fairness the manager/HR side already gets from seeing
// currentBalance on the approvals queue (ApprovalCard.tsx).
// ---------------------------------------------------------------------
export interface PreviewLeavePolicyParams {
  employeeId: string;
  leaveTypeCode: TrackerLeaveTypeCode;
  startDate: string;
  endDate?: string | null;
  isHalfDay: boolean;
  totalDays?: number;
  dayBreakdown?: DayBreakdownItem[];
}

export interface PreviewLeavePolicyResult {
  totalDays: number;
  notes: string[];
  // True if, as things stand right now, this request would be recorded
  // as LWP instead of the selected type (probation/notice-period, or
  // balance shortfall) — same trigger as convertedToLwp on the real
  // submit response, just computed ahead of time.
  wouldBeLwp: boolean;
  currentBalance: number | null;
  error?: string;
}

export async function previewLeavePolicy(
  params: PreviewLeavePolicyParams
): Promise<PreviewLeavePolicyResult> {
  const service = createLeaveServiceClient();
  const { employeeId, leaveTypeCode, isHalfDay, startDate, dayBreakdown } = params;
  const effectiveEndDate = isHalfDay ? startDate : (params.endDate || startDate);

  if (new Date(`${effectiveEndDate}T00:00:00Z`) < new Date(`${startDate}T00:00:00Z`)) {
    return { totalDays: 0, notes: [], wouldBeLwp: false, currentBalance: null, error: 'End date cannot be before start date.' };
  }

  let totalDays: number;
  if (dayBreakdown && dayBreakdown.length > 0) {
    totalDays = dayBreakdown.reduce((sum, d) => sum + (d.isHalfDay ? 0.5 : 1.0), 0);
  } else if (typeof params.totalDays === 'number' && params.totalDays > 0) {
    totalDays = params.totalDays;
  } else if (isHalfDay) {
    totalDays = 0.5;
  } else {
    totalDays = daysBetweenInclusive(startDate, effectiveEndDate);
  }

  if (totalDays <= 0 || Math.round(totalDays * 10) % 5 !== 0) {
    return {
      totalDays: 0,
      notes: [],
      wouldBeLwp: false,
      currentBalance: null,
      error: 'Leave duration must be in half-day increments (e.g. 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5...).',
    };
  }

  const { data: employee, error: empError } = await service
    .from('employees')
    .select('id, office, date_of_joining, employment_status, date_of_exit, notice_period_days, probation_months')
    .eq('id', employeeId)
    .single();
  if (empError || !employee) {
    return { totalDays, notes: [], wouldBeLwp: false, currentBalance: null, error: 'Could not load employee record.' };
  }

  const { data: leaveType, error: ltError } = await service
    .from('leave_types')
    .select('id, code, requires_certificate_after_days')
    .eq('code', leaveTypeCode)
    .single();
  if (ltError || !leaveType) {
    return { totalDays, notes: [], wouldBeLwp: false, currentBalance: null, error: 'Unknown leave type.' };
  }

  const notes: string[] = [];

  if (
    leaveType.code === 'SL' && !isHalfDay &&
    leaveType.requires_certificate_after_days != null &&
    totalDays > leaveType.requires_certificate_after_days
  ) {
    notes.push(
      `A medical certificate is required for Sick Leave beyond ${leaveType.requires_certificate_after_days} consecutive days.`
    );
  }

  if (leaveType.code === 'PL') {
    const { data: shortfall } = await service.rpc('fn_check_planned_leave_notice', {
      p_applied_on: new Date().toISOString().slice(0, 10),
      p_start_date: startDate,
      p_leave_length_days: totalDays,
    });
    if (typeof shortfall === 'number' && shortfall > 0) {
      notes.push(
        `Planned Leave needs ${totalDays <= 2 ? '2 weeks' : totalDays <= 7 ? '4 weeks' : '8 weeks'} notice for a request this length — ` +
        `on today's date that's short by the equivalent of ${shortfall} day(s), which will be recorded as Leave Without Pay unless you push the start date out.`
      );
    }
  }

  const combiningNote = await checkCombiningLeaves(
    service, employeeId, employee.office, leaveType.code, startDate, effectiveEndDate
  );
  if (combiningNote) notes.push(combiningNote);

  let wouldBeLwp = false;
  if (leaveType.code !== 'LWP') {
    const { config } = await getLeavePolicyConfig(service);
    const autoLwpReason = getAutoLwpConversionReason(
      employee as EmployeeForConversionCheck,
      startDate,
      // Per-employee override — see 0017_pending_signups_and_probation.sql's
      // employees.probation_months comment. Falls back to the company
      // default when unset, exactly as before.
      employee.probation_months ?? config.probationUnlockMonths
    );
    if (autoLwpReason) {
      notes.push(`${autoLwpReason} — this will be recorded as Leave Without Pay, not ${leaveType.code}.`);
      wouldBeLwp = true;
    }
  }

  // Balance-sufficiency: self_apply doesn't debit until manager_approval,
  // so today an employee only finds out they were short on the day it
  // gets approved. Surfacing it here at apply time is the "fair to the
  // applicant" part — they get to choose the honest type up front instead
  // of a request silently flipping to LWP behind their back later.
  let currentBalance: number | null = null;
  if (!wouldBeLwp && leaveType.code !== 'LWP') {
    const fyStartYear = fyStartYearForDate(startDate);
    const { rows: balanceRows } = await getEmployeeBalancesByFY(service, fyStartYear, employeeId);
    const row = balanceRows?.[0];
    if (row) {
      currentBalance = row[leaveType.code as 'SL' | 'CL' | 'PL'] ?? null;
      if (currentBalance !== null && currentBalance < totalDays) {
        notes.push(
          `You have ${currentBalance} day(s) of ${leaveType.code} remaining — this request needs ${totalDays}. ` +
          `The shortfall (${(totalDays - currentBalance).toFixed(2)} day(s)) will be recorded as Leave Without Pay once approved.`
        );
        wouldBeLwp = true;
      }
    }
  }

  return { totalDays, notes, wouldBeLwp, currentBalance };
}

// ---------------------------------------------------------------------
// self_apply / hr_manual — creates a new leave_requests row.
// hr_manual is inserted as 'approved' and debited immediately (matches
// the pre-existing app/api/leave/employees/requests/route.ts behavior
// exactly — see PROGRESS.md for the before/after verification).
// self_apply is inserted as 'pending' and is NOT debited yet — per
// schema.sql §6's own comment, fn_debit_leave_on_approval only runs once
// a row is 'approved', which for self_apply only happens later via a
// manager_approval call.
// ---------------------------------------------------------------------
async function createAndMaybeApprove(
  service: SupabaseClient,
  params: ApplyLeavePolicyAndMutateBalanceParams
): Promise<ApplyLeavePolicyAndMutateBalanceResult> {
  const { employeeId, leaveTypeCode, isHalfDay, halfDaySession, reason, actionPlan, source, actingEmployeeId, dayBreakdown } = params;
  const startDate = params.startDate;
  const effectiveEndDate = isHalfDay ? startDate : (params.endDate || startDate);

  if (new Date(`${effectiveEndDate}T00:00:00Z`) < new Date(`${startDate}T00:00:00Z`)) {
    return {
      requestId: null,
      violation: { type: 'invalid_date_range', reason: 'end_date cannot be before start_date' },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }

  let totalDays: number;
  if (dayBreakdown && dayBreakdown.length > 0) {
    totalDays = dayBreakdown.reduce((sum, d) => sum + (d.isHalfDay ? 0.5 : 1.0), 0);
  } else if (typeof params.totalDays === 'number' && params.totalDays > 0) {
    totalDays = params.totalDays;
  } else if (isHalfDay) {
    totalDays = 0.5;
  } else {
    totalDays = daysBetweenInclusive(startDate, effectiveEndDate);
  }

  if (totalDays <= 0 || Math.round(totalDays * 10) % 5 !== 0) {
    return {
      requestId: null,
      violation: { type: 'invalid_duration', reason: 'Leave duration must be in half-day increments (e.g. 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5...).' },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }

  const { data: employee, error: empError } = await service
    .from('employees')
    .select('id, employee_code, office, full_name, date_of_joining, employment_status, date_of_exit, notice_period_days, probation_months')
    .eq('id', employeeId)
    .single();
  if (empError || !employee) {
    return {
      requestId: null,
      violation: { type: 'employee_not_found', reason: `Employee not found: ${empError?.message ?? employeeId}` },
      convertedToLwp: false, policyNotes: [], totalDays, leaveRequest: null,
    };
  }

  const { data: leaveType, error: ltError } = await service
    .from('leave_types')
    .select('id, code, requires_certificate_after_days')
    .eq('code', leaveTypeCode)
    .single();
  if (ltError || !leaveType) {
    return {
      requestId: null,
      violation: { type: 'leave_type_not_found', reason: `Leave type not found: ${ltError?.message ?? leaveTypeCode}` },
      convertedToLwp: false, policyNotes: [], totalDays, leaveRequest: null,
    };
  }

  // Relevant policy checks are applied and surfaced, but never block
  // submission — same "advisory note" behavior the hr_manual route
  // already had (backdated entries / negotiated exceptions are the norm
  // for HR; self_apply keeping the same non-blocking behavior means a
  // future employee self-apply route doesn't need its own copy of this
  // reasoning either).
  const policyNotes: string[] = [];
  const entryLabel = source === 'hr_manual' ? 'for this HR entry' : 'automatically';

  if (
    leaveType.code === 'SL' && !isHalfDay &&
    leaveType.requires_certificate_after_days != null &&
    totalDays > leaveType.requires_certificate_after_days
  ) {
    policyNotes.push(
      `Handbook normally requires a medical certificate for SL beyond ${leaveType.requires_certificate_after_days} consecutive days — not enforced ${entryLabel}.`
    );
  }
  if (leaveType.code === 'PL') {
    const { data: shortfall } = await service.rpc('fn_check_planned_leave_notice', {
      p_applied_on: new Date().toISOString().slice(0, 10),
      p_start_date: startDate,
      p_leave_length_days: totalDays,
    });
    if (typeof shortfall === 'number' && shortfall > 0) {
      policyNotes.push(
        `Notice given falls short of the PL policy tier by an equivalent of ${shortfall} day(s) — not auto-converted to LWP ${entryLabel}.`
      );
    }
  }

  const combiningNote = await checkCombiningLeaves(
    service, employeeId, employee.office, leaveType.code, startDate, effectiveEndDate
  );
  if (combiningNote) policyNotes.push(combiningNote);

  // 2b/2c — probation-period and notice-period leave auto-convert to LWP
  // at recording time, regardless of source; submission is never
  // blocked. Probation is checked first (see getAutoLwpConversionReason).
  let leaveTypeForInsert: LeaveTypeRow = leaveType;
  let autoLwpReason: string | null = null;
  let autoLwpTypeRow: LeaveTypeRow | null = null;

  if (leaveType.code !== 'LWP') {
    const { config } = await getLeavePolicyConfig(service);
    autoLwpReason = getAutoLwpConversionReason(
      employee as EmployeeForConversionCheck,
      startDate,
      // Same per-employee override as the other call site above.
      employee.probation_months ?? config.probationUnlockMonths
    );
  }
  if (autoLwpReason) {
    const { data: lwpType, error: lwpFetchError } = await service
      .from('leave_types')
      .select('id, code, requires_certificate_after_days')
      .eq('code', 'LWP')
      .single();
    if (!lwpFetchError && lwpType) {
      autoLwpTypeRow = lwpType as LeaveTypeRow;
      leaveTypeForInsert = lwpType as LeaveTypeRow;
      policyNotes.push(`${autoLwpReason} — recorded as LWP instead of ${leaveType.code}.`);
    }
  }

  const initialStatus: 'approved' | 'pending' = source === 'hr_manual' ? 'approved' : 'pending';

  const { data: created, error: insertError } = await service
    .from('leave_requests')
    .insert({
      employee_id: employeeId,
      leave_type_id: leaveTypeForInsert.id,
      start_date: startDate,
      end_date: effectiveEndDate,
      is_half_day: !!isHalfDay,
      half_day_session: isHalfDay ? halfDaySession : null,
      total_days: totalDays,
      reason,
      action_plan: actionPlan ?? null,
      status: initialStatus,
      source: dbSourceFor(source),
      is_lwp_override: !!(autoLwpReason && autoLwpTypeRow),
      lwp_override_reason: autoLwpReason && autoLwpTypeRow ? autoLwpReason : null,
    })
    .select()
    .single();
  if (insertError || !created) {
    return {
      requestId: null,
      violation: { type: 'insert_failed', reason: insertError?.message ?? 'Failed to create leave request' },
      convertedToLwp: false, policyNotes, totalDays, leaveRequest: null,
    };
  }

  if (initialStatus === 'pending') {
    // self_apply — nothing to debit yet; that happens on manager_approval.
    await notifyLeaveEvent(service, {
      type: 'submitted',
      requestId: created.id,
      employeeId,
      source,
      leaveTypeCode: leaveTypeForInsert.code as TrackerLeaveTypeCode,
      isHalfDay: !!isHalfDay,
      startDate,
      endDate: effectiveEndDate,
      violationNote: policyNotes[0] ?? null,
    });
    return {
      requestId: created.id,
      convertedToLwp: false,
      policyNotes,
      totalDays,
      leaveRequest: { ...created, leave_type_id: leaveTypeForInsert.id },
    };
  }

  // Reconcile biometric attendance BEFORE debiting the balance. This is
  // important when the employee has exactly enough balance for the actual
  // attendance-adjusted leave (e.g. 2.5 days), but not enough for the raw
  // 3-day range entered by HR.
  const attendanceReconciliation = await reconcileLeaveRequestAgainstAttendance(service, created.id);
  if (!attendanceReconciliation.ok) {
    policyNotes.push(`Attendance half-day reconciliation could not be completed: ${attendanceReconciliation.error}`);
  } else if (attendanceReconciliation.adjusted) {
    policyNotes.push(`Biometric attendance adjusted this leave from ${attendanceReconciliation.previousTotal} to ${attendanceReconciliation.totalDays} day(s). Short-day date(s): ${attendanceReconciliation.shortDates.join(', ')}.`);
  }

  // hr_manual — S1-1: debit the balance atomically.
  // fn_debit_leave_on_approval() raises when the requested paid type
  // (SL/CL/PL) doesn't have enough balance. Per spec, that is never a
  // hard rejection: the entry is auto-converted to LWP (which draws from
  // no pool, so it always succeeds) and the caller is told why. Only a
  // genuine second failure (e.g. no LWP balance row provisioned at all)
  // falls back to rejecting and undoing the insert.
  let finalLeaveType = leaveTypeForInsert;
  let convertedToLwp = false;

  const debitOutcome = await debitWithLwpFallback(service, created.id, finalLeaveType);
  if (debitOutcome.error) {
    await service.from('leave_requests').delete().eq('id', created.id);
    return {
      requestId: null,
      violation: { type: 'debit_failed', reason: debitOutcome.error.message },
      convertedToLwp: false, policyNotes, totalDays, leaveRequest: null,
    };
  }
  if (debitOutcome.convertedToLwp) {
    finalLeaveType = debitOutcome.finalLeaveType!;
    convertedToLwp = true;
    policyNotes.push(debitOutcome.note!);
  }

  // S1-3: synthetic approval_steps row so the audit trail reads
  // consistently even though no real lead -> manager -> HR chain ran.
  if (actingEmployeeId) {
    await service.from('approval_steps').insert({
      leave_request_id: created.id,
      approver_id: actingEmployeeId,
      approver_role: params.approverRole ?? 'hr',
      sequence_order: 1,
      status: 'approved',
      comment: 'Recorded directly by HR (hr_manual) — no approval chain run.',
      acted_on: new Date().toISOString(),
    });
  }

  await notifyLeaveEvent(service, {
    type: 'approved',
    requestId: created.id,
    employeeId,
    source,
    convertedToLwp,
    leaveTypeCode: finalLeaveType.code as TrackerLeaveTypeCode,
    isHalfDay: !!isHalfDay,
    startDate,
    endDate: effectiveEndDate,
  });

  return {
    requestId: created.id,
    convertedToLwp,
    policyNotes,
    totalDays: attendanceReconciliation.ok ? attendanceReconciliation.totalDays : totalDays,
    leaveRequest: attendanceReconciliation.adjusted
      ? { ...created, total_days: attendanceReconciliation.totalDays, leave_type_id: finalLeaveType.id }
      : { ...created, leave_type_id: finalLeaveType.id },
  };
}

// ---------------------------------------------------------------------
// manager_approval — moves an existing 'pending' row to 'approved' and
// debits it (with the same LWP fallback as hr_manual). Not wired to any
// route yet — first real caller will be the future manager-approval
// endpoint; exercised here only structurally/by future callers, not by
// this prompt's required verification (that's hr_manual only).
// ---------------------------------------------------------------------
async function approveExistingRequest(
  service: SupabaseClient,
  existingRequestId: string | undefined,
  actingEmployeeId: string | null | undefined,
  approverRole: 'lead' | 'manager' | 'hr'
): Promise<ApplyLeavePolicyAndMutateBalanceResult> {
  if (!existingRequestId) {
    return {
      requestId: null,
      violation: { type: 'missing_request_id', reason: 'manager_approval requires existingRequestId — there is no request to approve without it.' },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }

  const { data: existing, error: fetchError } = await service
    .from('leave_requests')
    .select('*, leave_types ( id, code, requires_certificate_after_days )')
    .eq('id', existingRequestId)
    .single();
  if (fetchError || !existing) {
    return {
      requestId: null,
      violation: { type: 'request_not_found', reason: fetchError?.message ?? `leave_requests row ${existingRequestId} not found` },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }
  if (existing.status !== 'pending') {
    return {
      requestId: existingRequestId,
      violation: { type: 'invalid_status', reason: `Cannot approve a request in status '${existing.status}' — only 'pending' requests can be approved.` },
      convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
    };
  }

  const currentLeaveType: LeaveTypeRow = Array.isArray(existing.leave_types) ? existing.leave_types[0] : existing.leave_types;

  const { error: updateError } = await service
    .from('leave_requests')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', existingRequestId);
  if (updateError) {
    return {
      requestId: existingRequestId,
      violation: { type: 'update_failed', reason: updateError.message },
      convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
    };
  }

  // Reconcile before debiting so biometric evidence can prevent an unnecessary
  // LWP conversion when the raw date range is larger than the actual leave
  // consumed (for example 3 entered days becoming 2.5 after a short day).
  const attendanceReconciliation = await reconcileLeaveRequestAgainstAttendance(service, existingRequestId);
  const approvalPolicyNotes: string[] = [];
  if (attendanceReconciliation.ok && attendanceReconciliation.adjusted) {
    approvalPolicyNotes.push(`Biometric attendance adjusted this leave from ${attendanceReconciliation.previousTotal} to ${attendanceReconciliation.totalDays} day(s). Short-day date(s): ${attendanceReconciliation.shortDates.join(', ')}.`);
  } else if (!attendanceReconciliation.ok) {
    approvalPolicyNotes.push(`Attendance half-day reconciliation could not be completed: ${attendanceReconciliation.error}`);
  }

  const debitOutcome = await debitWithLwpFallback(service, existingRequestId, currentLeaveType);
  if (debitOutcome.error) {
    // An approval that can't be debited (and can't even fall back to
    // LWP) shouldn't silently sit as "approved" with no corresponding
    // balance movement — roll the status change back.
    await service.from('leave_requests').update({ status: 'pending' }).eq('id', existingRequestId);
    return {
      requestId: existingRequestId,
      violation: { type: 'debit_failed', reason: debitOutcome.error.message },
      convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
    };
  }

  const policyNotes: string[] = approvalPolicyNotes;
  let convertedToLwp = false;
  let finalLeaveType = currentLeaveType;
  if (debitOutcome.convertedToLwp) {
    convertedToLwp = true;
    finalLeaveType = debitOutcome.finalLeaveType!;
    policyNotes.push(debitOutcome.note!);
  }

  if (actingEmployeeId) {
    await service.from('approval_steps').insert({
      leave_request_id: existingRequestId,
      approver_id: actingEmployeeId,
      approver_role: approverRole,
      sequence_order: 1,
      status: 'approved',
      acted_on: new Date().toISOString(),
    });
  }

  await notifyLeaveEvent(service, {
    type: 'approved',
    requestId: existingRequestId,
    employeeId: existing.employee_id,
    source: 'manager_approval',
    convertedToLwp,
    leaveTypeCode: finalLeaveType.code as TrackerLeaveTypeCode,
    isHalfDay: !!existing.is_half_day,
    startDate: existing.start_date,
    endDate: existing.end_date,
  });

  const { data: persistedRequest } = await service.from('leave_requests').select('*').eq('id', existingRequestId).single();
  const persisted = persistedRequest ?? existing;
  return {
    requestId: existingRequestId,
    convertedToLwp,
    policyNotes,
    totalDays: Number(persisted.total_days),
    leaveRequest: { ...persisted, leave_type_id: finalLeaveType.id, status: 'approved' },
  };
}

// ---------------------------------------------------------------------
// manager_reject — moves an existing 'pending' row to 'rejected'. No
// balance change (it was never debited — only approved/auto_lwp rows
// are), no LWP fallback, no team broadcast. Requires a comment (the
// approvals queue UI enforces this client-side too, but it's re-checked
// here since this function is the actual write boundary).
// ---------------------------------------------------------------------
async function rejectExistingRequest(
  service: SupabaseClient,
  existingRequestId: string | undefined,
  actingEmployeeId: string | null | undefined,
  rejectionComment: string | undefined
): Promise<ApplyLeavePolicyAndMutateBalanceResult> {
  if (!existingRequestId) {
    return {
      requestId: null,
      violation: { type: 'missing_request_id', reason: 'manager_reject requires existingRequestId — there is no request to reject without it.' },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }
  if (!rejectionComment || !rejectionComment.trim()) {
    return {
      requestId: existingRequestId,
      violation: { type: 'missing_comment', reason: 'A short comment is required to reject a leave request.' },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }

  const { data: existing, error: fetchError } = await service
    .from('leave_requests')
    .select('*, leave_types ( id, code )')
    .eq('id', existingRequestId)
    .single();
  if (fetchError || !existing) {
    return {
      requestId: null,
      violation: { type: 'request_not_found', reason: fetchError?.message ?? `leave_requests row ${existingRequestId} not found` },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }
  if (existing.status !== 'pending') {
    return {
      requestId: existingRequestId,
      violation: { type: 'invalid_status', reason: `Cannot reject a request in status '${existing.status}' — only 'pending' requests can be rejected.` },
      convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
    };
  }

  const { error: updateError } = await service
    .from('leave_requests')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', existingRequestId);
  if (updateError) {
    return {
      requestId: existingRequestId,
      violation: { type: 'update_failed', reason: updateError.message },
      convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
    };
  }

  if (actingEmployeeId) {
    await service.from('approval_steps').insert({
      leave_request_id: existingRequestId,
      approver_id: actingEmployeeId,
      approver_role: 'manager',
      sequence_order: 1,
      status: 'rejected',
      comment: rejectionComment,
      acted_on: new Date().toISOString(),
    });
  }

  await notifyLeaveEvent(service, {
    type: 'rejected',
    requestId: existingRequestId,
    employeeId: existing.employee_id,
    source: 'manager_reject',
    rejectionComment,
    startDate: existing.start_date,
    endDate: existing.end_date,
  });

  // Part C, §C.5 — rejecting a half-day request that originated from
  // the employee's own attendance-exception response is itself a
  // decision: it auto-converts to LWP immediately rather than leaving
  // the day unresolved again. A no-op for any ordinary leave request
  // that never had a linked attendance_exceptions row (see the
  // function's own header comment).
  await applyAutoLwpForRejectedRequest(service, existingRequestId, actingEmployeeId ?? null);

  return {
    requestId: existingRequestId,
    convertedToLwp: false,
    policyNotes: [],
    totalDays: existing.total_days,
    leaveRequest: { ...existing, status: 'rejected' },
  };
}

// ---------------------------------------------------------------------
// Part C escalation — system-generated LWP writes (§C.5). Kept in THIS
// file (rather than a separate module) specifically to respect the
// "only function allowed to write to leave_balances,
// balance_transactions, or leave_requests" invariant in the header
// comment above — these deliberately bypass the normal policy engine
// (checkCombiningLeaves, getAutoLwpConversionReason, etc.) because a
// forced escalation to LWP is the one path that must always succeed
// regardless of policy/balance caps; LWP is the uncapped escape valve
// by design (see leave_types.is_directly_applicable in schema.sql).
//
// createSystemAutoLwpRequest — brand-new single-day row, status
//   'auto_lwp' from birth. Used for: HR's ACK on an unmarked attendance
//   exception, HR's ACK on a pending regularisation, and a manager
//   rejecting a regularisation request that originated from Part C.
// convertPendingRequestToAutoLwp — retypes an EXISTING pending row (an
//   employee's own "actual half day" self_apply request) in place.
//   Used for: HR's ACK on a pending half-day request, and a manager
//   rejecting that same half-day request (rejectExistingRequest above).
// ---------------------------------------------------------------------

export interface CreateSystemAutoLwpInput {
  employeeId: string;
  date: string;
  isHalfDay: boolean;
  reason: string;
}

async function getLwpLeaveTypeId(service: SupabaseClient): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await service.from('leave_types').select('id').eq('code', 'LWP').single();
  if (error || !data) return { id: null, error: error?.message ?? 'LWP leave type not found' };
  return { id: data.id, error: null };
}

export async function createSystemAutoLwpRequest(
  service: SupabaseClient,
  input: CreateSystemAutoLwpInput
): Promise<{ requestId: string | null; error: string | null }> {
  const { id: lwpTypeId, error: typeError } = await getLwpLeaveTypeId(service);
  if (!lwpTypeId) return { requestId: null, error: typeError };

  const { data: created, error: insertError } = await service
    .from('leave_requests')
    .insert({
      employee_id: input.employeeId,
      leave_type_id: lwpTypeId,
      start_date: input.date,
      end_date: input.date,
      is_half_day: !!input.isHalfDay,
      half_day_session: null,
      total_days: input.isHalfDay ? 0.5 : 1,
      reason: input.reason,
      status: 'auto_lwp',
      source: 'hr_manual', // DB constraint only knows employee_apply/hr_manual (see header comment) — a system-generated entry is closest in spirit to an HR-side write
      is_lwp_override: true,
      lwp_override_reason: input.reason,
    })
    .select('id')
    .single();
  if (insertError || !created) {
    return { requestId: null, error: insertError?.message ?? 'Could not create the auto-LWP request.' };
  }

  const { error: debitError } = await service.rpc('fn_debit_leave_on_approval', { p_leave_request_id: created.id });
  if (debitError) {
    // Roll back rather than leave an un-debited auto_lwp row sitting
    // around looking terminal when it isn't.
    await service.from('leave_requests').delete().eq('id', created.id);
    return { requestId: null, error: `Could not debit LWP balance: ${debitError.message}` };
  }

  await notifyLeaveEvent(service, {
    type: 'approved',
    requestId: created.id,
    employeeId: input.employeeId,
    source: 'hr_manual',
    convertedToLwp: true,
    leaveTypeCode: 'LWP',
    isHalfDay: !!input.isHalfDay,
    startDate: input.date,
    endDate: input.date,
  });

  return { requestId: created.id, error: null };
}

export async function convertPendingRequestToAutoLwp(
  service: SupabaseClient,
  requestId: string,
  reason: string
): Promise<{ requestId: string | null; error: string | null }> {
  const { data: existing, error: fetchError } = await service
    .from('leave_requests')
    .select('id, employee_id, status, start_date, end_date, is_half_day')
    .eq('id', requestId)
    .single();
  if (fetchError || !existing) return { requestId: null, error: fetchError?.message ?? 'Leave request not found.' };
  if (existing.status !== 'pending') {
    return { requestId, error: `Cannot convert a request in status '${existing.status}' — only 'pending' requests can be escalated.` };
  }

  const { id: lwpTypeId, error: typeError } = await getLwpLeaveTypeId(service);
  if (!lwpTypeId) return { requestId, error: typeError };

  const { error: updateError } = await service
    .from('leave_requests')
    .update({
      leave_type_id: lwpTypeId,
      status: 'auto_lwp',
      is_lwp_override: true,
      lwp_override_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId);
  if (updateError) return { requestId, error: updateError.message };

  const { error: debitError } = await service.rpc('fn_debit_leave_on_approval', { p_leave_request_id: requestId });
  if (debitError) {
    await service.from('leave_requests').update({ status: 'pending' }).eq('id', requestId);
    return { requestId, error: `Could not debit LWP balance: ${debitError.message}` };
  }

  await notifyLeaveEvent(service, {
    type: 'approved',
    requestId,
    employeeId: existing.employee_id,
    source: 'hr_manual',
    convertedToLwp: true,
    leaveTypeCode: 'LWP',
    isHalfDay: existing.is_half_day,
    startDate: existing.start_date,
    endDate: existing.end_date,
  });

  return { requestId, error: null };
}

// applyAutoLwpForRejectedRequest — called from rejectExistingRequest
// above right after a rejection succeeds. A no-op for any ordinary
// rejection: only fires when the rejected row is linked to an
// attendance_exceptions row with employee_choice='half_day', i.e. it
// originated from Part C's employee self-serve flow.
async function applyAutoLwpForRejectedRequest(
  service: SupabaseClient,
  rejectedRequestId: string,
  actingEmployeeId: string | null
): Promise<void> {
  const { data: exception } = await service
    .from('attendance_exceptions')
    .select('id, employee_id, exception_date')
    .eq('leave_request_id', rejectedRequestId)
    .eq('employee_choice', 'half_day')
    .maybeSingle();
  if (!exception) return;

  const { data: original } = await service.from('leave_requests').select('is_half_day').eq('id', rejectedRequestId).maybeSingle();

  const { requestId } = await createSystemAutoLwpRequest(service, {
    employeeId: exception.employee_id,
    date: exception.exception_date,
    isHalfDay: !!original?.is_half_day,
    reason: 'Auto-converted to Leave Without Pay — manager rejected the half-day request.',
  });

  await service
    .from('attendance_exceptions')
    .update({
      resolution: 'lwp',
      leave_request_id: requestId,
      resolved_by: actingEmployeeId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', exception.id);

  await service
    .from('escalation_reminders')
    .update({ acked_by: actingEmployeeId, acked_at: new Date().toISOString() })
    .eq('target_type', 'leave_request_pending')
    .eq('target_id', rejectedRequestId);
}

// Mirrors applyAutoLwpForRejectedRequest above, for the
// leave_regularisations table — called from the regularisation reject
// route (app/api/leave/regularisations/[id]/reject), which is outside
// this file's normal source-dispatch since regularisations aren't
// leave_requests rows at all.
export async function applyAutoLwpForRejectedRegularisation(
  service: SupabaseClient,
  rejectedRegularisationId: string,
  actingEmployeeId: string | null
): Promise<void> {
  const { data: exception } = await service
    .from('attendance_exceptions')
    .select('id, employee_id, exception_date')
    .eq('regularisation_id', rejectedRegularisationId)
    .maybeSingle();
  if (!exception) return;

  const { requestId } = await createSystemAutoLwpRequest(service, {
    employeeId: exception.employee_id,
    date: exception.exception_date,
    isHalfDay: false,
    reason: 'Auto-converted to Leave Without Pay — manager rejected the regularisation request.',
  });

  await service
    .from('attendance_exceptions')
    .update({
      resolution: 'lwp',
      leave_request_id: requestId,
      resolved_by: actingEmployeeId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', exception.id);

  await service
    .from('escalation_reminders')
    .update({ acked_by: actingEmployeeId, acked_at: new Date().toISOString() })
    .eq('target_type', 'regularisation_pending')
    .eq('target_id', rejectedRegularisationId);
}

// ---------------------------------------------------------------------
// cancellation — acts on an existing row. If it had already been
// debited (status 'approved' or 'auto_lwp'), credits the days back via
// a 'leave_cancelled' balance_transactions row (mirrors
// fn_debit_leave_on_approval's own FY-resolution, in reverse). A still-
// 'pending' row (never debited) just moves straight to 'cancelled'. Not
// wired to any route yet — same caveat as approveExistingRequest above.
// ---------------------------------------------------------------------
async function cancelExistingRequest(
  service: SupabaseClient,
  existingRequestId: string | undefined
): Promise<ApplyLeavePolicyAndMutateBalanceResult> {
  if (!existingRequestId) {
    return {
      requestId: null,
      violation: { type: 'missing_request_id', reason: 'cancellation requires existingRequestId — there is no request to cancel without it.' },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }

  const { data: existing, error: fetchError } = await service
    .from('leave_requests')
    .select('*, leave_types ( id, code )')
    .eq('id', existingRequestId)
    .single();
  if (fetchError || !existing) {
    return {
      requestId: null,
      violation: { type: 'request_not_found', reason: fetchError?.message ?? `leave_requests row ${existingRequestId} not found` },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }
  if (existing.status === 'cancelled' || existing.status === 'rejected') {
    return {
      requestId: existingRequestId,
      violation: { type: 'invalid_status', reason: `Request is already '${existing.status}' — nothing to cancel.` },
      convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
    };
  }

  const wasDebited = existing.status === 'approved' || existing.status === 'auto_lwp';
  const leaveType = Array.isArray(existing.leave_types) ? existing.leave_types[0] : existing.leave_types;

  if (wasDebited) {
    const fyStartYear = fyStartYearForDate(existing.start_date);
    const { data: balance, error: balError } = await service
      .from('leave_balances')
      .select('id, used')
      .eq('employee_id', existing.employee_id)
      .eq('leave_type_id', existing.leave_type_id)
      .eq('fy_start_year', fyStartYear)
      .single();
    if (balError || !balance) {
      return {
        requestId: existingRequestId,
        violation: {
          type: 'balance_not_found',
          reason: balError?.message ?? `No leave_balances row for employee ${existing.employee_id}, type ${leaveType?.code}, FY${fyStartYear} — cannot reverse the debit.`,
        },
        convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
      };
    }

    const { error: creditError } = await service
      .from('leave_balances')
      .update({ used: balance.used - existing.total_days, updated_at: new Date().toISOString() })
      .eq('id', balance.id);
    if (creditError) {
      return {
        requestId: existingRequestId,
        violation: { type: 'credit_back_failed', reason: creditError.message },
        convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
      };
    }

    await service.from('balance_transactions').insert({
      leave_balance_id: balance.id,
      delta: existing.total_days,
      reason: 'leave_cancelled',
      reference_id: existingRequestId,
      note: `Credited back ${existing.total_days} day(s) — leave_requests ${existingRequestId} cancelled (was ${existing.status}, ${existing.start_date} to ${existing.end_date}).`,
    });
  }

  const { error: updateError } = await service
    .from('leave_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', existingRequestId);
  if (updateError) {
    return {
      requestId: existingRequestId,
      violation: { type: 'update_failed', reason: updateError.message },
      convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
    };
  }

  await notifyLeaveEvent(service, {
    type: 'cancelled',
    requestId: existingRequestId,
    employeeId: existing.employee_id,
    source: 'cancellation',
    leaveTypeCode: leaveType?.code as TrackerLeaveTypeCode | undefined,
    isHalfDay: !!existing.is_half_day,
    startDate: existing.start_date,
    endDate: existing.end_date,
  });

  return {
    requestId: existingRequestId,
    convertedToLwp: false,
    policyNotes: [],
    totalDays: existing.total_days,
    leaveRequest: { ...existing, status: 'cancelled' },
  };
}

// ---------------------------------------------------------------------
// hr_correction — HR reverses an 'approved'/'auto_lwp' request that
// cancelExistingRequest can no longer touch because its leave has
// already started/finished (that route's own already-started guard is
// deliberate — you cannot "cancel" something that already happened).
// This is a data-correction tool instead: "the record is wrong, credit
// the days back", distinct from cancellation in three ways —
//   1. No already-started/already-finished restriction at all (the
//      whole point is to reach rows a normal cancel can't).
//   2. A reason is mandatory (schema: leave_requests.correction_reason
//      NOT enforced NOT NULL at the DB level, but this function refuses
//      to proceed without one — same "re-checked at the write boundary"
//      posture as rejectExistingRequest's comment requirement).
//   3. Tags corrected_by/correction_reason/corrected_at on the row
//      (migration 0013) so the UI can render "Reversed by HR — <reason>"
//      distinctly from a plain employee/HR cancellation, instead of the
//      two being indistinguishable once both just say status=cancelled.
// Still reuses status='cancelled' — every existing reader (balance
// math, history filters, badge colors) already treats that status as
// "not counted, nothing owed", which is exactly right here too.
// ---------------------------------------------------------------------
async function hrCorrectExistingRequest(
  service: SupabaseClient,
  existingRequestId: string | undefined,
  actingEmployeeId: string | null | undefined,
  correctionReason: string | undefined
): Promise<ApplyLeavePolicyAndMutateBalanceResult> {
  if (!existingRequestId) {
    return {
      requestId: null,
      violation: { type: 'missing_request_id', reason: 'hr_correction requires existingRequestId — there is no request to correct without it.' },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }
  if (!actingEmployeeId) {
    return {
      requestId: existingRequestId,
      violation: { type: 'missing_actor', reason: 'hr_correction requires the acting HR employee to be identified.' },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }
  if (!correctionReason || !correctionReason.trim()) {
    return {
      requestId: existingRequestId,
      violation: { type: 'missing_reason', reason: 'A reason is required to correct/reverse a leave record.' },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }

  const { data: existing, error: fetchError } = await service
    .from('leave_requests')
    .select('*, leave_types ( id, code )')
    .eq('id', existingRequestId)
    .single();
  if (fetchError || !existing) {
    return {
      requestId: null,
      violation: { type: 'request_not_found', reason: fetchError?.message ?? `leave_requests row ${existingRequestId} not found` },
      convertedToLwp: false, policyNotes: [], totalDays: 0, leaveRequest: null,
    };
  }
  if (existing.status !== 'approved' && existing.status !== 'auto_lwp') {
    return {
      requestId: existingRequestId,
      violation: {
        type: 'invalid_status',
        reason: `Cannot correct a request in status '${existing.status}' — only an approved (or LWP) request has a debit to reverse. A still-pending request should be withdrawn/cancelled instead.`,
      },
      convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
    };
  }

  const leaveType = Array.isArray(existing.leave_types) ? existing.leave_types[0] : existing.leave_types;
  const fyStartYear = fyStartYearForDate(existing.start_date);
  const { data: balance, error: balError } = await service
    .from('leave_balances')
    .select('id, used')
    .eq('employee_id', existing.employee_id)
    .eq('leave_type_id', existing.leave_type_id)
    .eq('fy_start_year', fyStartYear)
    .single();
  if (balError || !balance) {
    return {
      requestId: existingRequestId,
      violation: {
        type: 'balance_not_found',
        reason: balError?.message ?? `No leave_balances row for employee ${existing.employee_id}, type ${leaveType?.code}, FY${fyStartYear} — cannot reverse the debit.`,
      },
      convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
    };
  }

  const { error: creditError } = await service
    .from('leave_balances')
    .update({ used: balance.used - existing.total_days, updated_at: new Date().toISOString() })
    .eq('id', balance.id);
  if (creditError) {
    return {
      requestId: existingRequestId,
      violation: { type: 'credit_back_failed', reason: creditError.message },
      convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
    };
  }

  await service.from('balance_transactions').insert({
    leave_balance_id: balance.id,
    delta: existing.total_days,
    reason: 'leave_cancelled',
    reference_id: existingRequestId,
    created_by: actingEmployeeId,
    note: `HR correction: credited back ${existing.total_days} day(s) — leave_requests ${existingRequestId} reversed (was ${existing.status}, ${existing.start_date} to ${existing.end_date}). Reason: ${correctionReason}`,
  });

  const nowIso = new Date().toISOString();
  const { error: updateError } = await service
    .from('leave_requests')
    .update({
      status: 'cancelled',
      corrected_by: actingEmployeeId,
      correction_reason: correctionReason,
      corrected_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', existingRequestId);
  if (updateError) {
    return {
      requestId: existingRequestId,
      violation: { type: 'update_failed', reason: updateError.message },
      convertedToLwp: false, policyNotes: [], totalDays: existing.total_days, leaveRequest: existing,
    };
  }

  await notifyLeaveEvent(service, {
    type: 'corrected',
    requestId: existingRequestId,
    employeeId: existing.employee_id,
    source: 'hr_correction',
    leaveTypeCode: leaveType?.code as TrackerLeaveTypeCode | undefined,
    isHalfDay: !!existing.is_half_day,
    startDate: existing.start_date,
    endDate: existing.end_date,
    correctionReason,
  });

  return {
    requestId: existingRequestId,
    convertedToLwp: false,
    policyNotes: [],
    totalDays: existing.total_days,
    leaveRequest: {
      ...existing,
      status: 'cancelled',
      corrected_by: actingEmployeeId,
      correction_reason: correctionReason,
      corrected_at: nowIso,
    },
  };
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------
export async function applyLeavePolicyAndMutateBalance(
  params: ApplyLeavePolicyAndMutateBalanceParams
): Promise<ApplyLeavePolicyAndMutateBalanceResult> {
  const service = createLeaveServiceClient();
  const approverRole = params.approverRole ?? (params.source === 'hr_manual' ? 'hr' : 'manager');

  if (params.source === 'cancellation') {
    return cancelExistingRequest(service, params.existingRequestId);
  }
  if (params.source === 'hr_correction') {
    return hrCorrectExistingRequest(service, params.existingRequestId, params.actingEmployeeId, params.correctionReason);
  }
  if (params.source === 'manager_approval') {
    return approveExistingRequest(service, params.existingRequestId, params.actingEmployeeId, approverRole);
  }
  if (params.source === 'manager_reject') {
    return rejectExistingRequest(service, params.existingRequestId, params.actingEmployeeId, params.rejectionComment);
  }
  // self_apply / hr_manual
  return createAndMaybeApprove(service, params);
}