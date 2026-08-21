import type { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveApproverId } from './organization';
import { insertLeaveNotification } from './notifyLeaveEvent';
import {
  applyLeavePolicyAndMutateBalance,
  createSystemAutoLwpRequest,
  convertPendingRequestToAutoLwp,
} from './applyLeavePolicyAndMutateBalance';
import { createEmployeeRegularisationRequest } from './regularisation';
import type { TrackerLeaveTypeCode } from './leaveTypeMap';
import { getAttendanceExceptionsAllPending } from '../attendanceExceptions';

// =====================================================================
// attendanceEscalation — MASTER_PLAN_CONSOLIDATED.md Part C.
//
//   respondToAttendanceException — employee's 3-option submission from
//     /leave/me (§C.2).
//   sendEscalationReminder — the one function both the daily cron and
//     the manual "Remind now" button call, for either escalation stage
//     (§C.5's "hybrid reminder delivery").
//   ackEscalationToLwp — HR's ACK action, gated on reminder_count >= 3,
//     always converts to LWP (§C.4).
//
// The manager-rejection auto-LWP hooks (§C.5's "rejecting IS a
// decision — no reminder wait needed") live in
// applyLeavePolicyAndMutateBalance.ts instead (applyAutoLwpForRejectedRequest,
// called internally from rejectExistingRequest) and are re-exported
// from here where regularisation-specific (applyAutoLwpForRejectedRegularisation)
// — see the comment near that re-export below for why the split.
// =====================================================================

export type EscalationTargetType = 'attendance_exception_unmarked' | 'leave_request_pending' | 'regularisation_pending';

export type AttendanceExceptionChoice = 'missed_punch' | 'half_day' | 'regularise';

export interface RespondToAttendanceExceptionInput {
  exceptionId: string;
  employeeId: string; // must match attendance_exceptions.employee_id — enforced by the caller (route) resolving the session first
  choice: AttendanceExceptionChoice;
  note: string;
  // required only for choice === 'half_day' — which paid leave type
  // this half day should draw from, subject to normal policy/balance
  // rules the same way a self-applied half day would be.
  leaveTypeCode?: TrackerLeaveTypeCode;
}

export interface RespondResult {
  ok: boolean;
  error?: string;
  leaveRequestId?: string | null;
  regularisationId?: string | null;
}

type ExceptionRow = {
  id: string;
  employee_id: string;
  exception_date: string;
  exception_type: string;
  first_punch: string | null;
  last_punch: string | null;
  resolution: string;
  employee_choice: string | null;
};

// ---------------------------------------------------------------------
// getMyUnmarkedAttendanceExceptions — backs the employee-facing review
// cards on /leave/me (§C.2). Reuses the exact same detection HR's
// Absentees/Half Day tabs already run (getAttendanceExceptionsAllPending,
// scoped down to this one employee) rather than a second classifier, so
// the two views can never disagree about what counts as unmarked.
//
// Detection alone doesn't have stable ids to respond against, so any
// candidate not yet backed by a real attendance_exceptions row gets one
// created here, lazily, on read — resolution='pending',
// employee_choice=null. Safe to upsert: getAttendanceExceptionsAllPending
// already excludes anything with employee_choice set or resolution !=
// 'pending' (see attendanceExceptions.ts), so any candidate reaching
// this point is guaranteed to either have no row yet or an already-bare
// pending/unmarked one.
// ---------------------------------------------------------------------
export type MyUnmarkedException = {
  id: string;
  date: string;
  kind: 'absent' | 'possible_half_day';
  firstPunch: string | null;
  lastPunch: string | null;
  reason: string | null;
};

export async function getMyUnmarkedAttendanceExceptions(
  service: SupabaseClient,
  employeeId: string
): Promise<{ exceptions: MyUnmarkedException[]; error: string | null }> {
  let range;
  try {
    range = await getAttendanceExceptionsAllPending(service);
  } catch (err) {
    return { exceptions: [], error: err instanceof Error ? err.message : 'Could not load attendance exceptions.' };
  }

  const myAbsentees = range.absentees.filter((a) => a.employeeId === employeeId);
  const myHalfDays = range.halfDayCandidates.filter((h) => h.employeeId === employeeId);
  if (myAbsentees.length === 0 && myHalfDays.length === 0) return { exceptions: [], error: null };

  const rows = [
    ...myAbsentees.map((a) => ({
      employee_id: employeeId,
      exception_date: a.date,
      exception_type: 'absent' as const,
      first_punch: null as string | null,
      last_punch: null as string | null,
      resolution: 'pending' as const,
    })),
    ...myHalfDays.map((h) => ({
      employee_id: employeeId,
      exception_date: h.date,
      exception_type: 'possible_half_day' as const,
      first_punch: h.firstPunch,
      last_punch: h.lastPunch,
      resolution: 'pending' as const,
    })),
  ];

  const { data: upserted, error } = await service
    .from('attendance_exceptions')
    .upsert(rows, { onConflict: 'employee_id,exception_date', ignoreDuplicates: false })
    .select('id, exception_date, exception_type, first_punch, last_punch, resolution_note');
  if (error) return { exceptions: [], error: error.message };

  return {
    exceptions: (upserted ?? []).map((r) => ({
      id: r.id,
      date: r.exception_date,
      kind: r.exception_type as 'absent' | 'possible_half_day',
      firstPunch: r.first_punch,
      lastPunch: r.last_punch,
      reason: r.resolution_note,
    })),
    error: null,
  };
}

// ---------------------------------------------------------------------
// ensureAttendanceExceptionRows — the HR-facing counterpart to
// getMyUnmarkedAttendanceExceptions's lazy upsert, for
// AbsenteesPanel.tsx / HalfDayPanel.tsx (which compute candidates live
// via getAttendanceExceptions* and previously had no need for a stable
// row id — everything used to be resolved in the same request). Now
// that HR's only actions are Remind/ACK (§C.4), both need a real
// escalation_reminders target id, so this makes sure one exists for
// every candidate row the panel is about to render, and returns each
// one's current reminder_count alongside it.
// ---------------------------------------------------------------------
export type EnsuredExceptionKey = string; // `${employeeId}__${date}`

export function exceptionKey(employeeId: string, date: string): EnsuredExceptionKey {
  return `${employeeId}__${date}`;
}

export async function ensureAttendanceExceptionRows(
  service: SupabaseClient,
  entries: { employeeId: string; date: string; kind: 'absent' | 'possible_half_day'; firstPunch?: string | null; lastPunch?: string | null }[]
): Promise<Map<EnsuredExceptionKey, { id: string; reminderCount: number }>> {
  const result = new Map<EnsuredExceptionKey, { id: string; reminderCount: number }>();
  if (entries.length === 0) return result;

  const rows = entries.map((e) => ({
    employee_id: e.employeeId,
    exception_date: e.date,
    exception_type: e.kind,
    first_punch: e.firstPunch ?? null,
    last_punch: e.lastPunch ?? null,
    resolution: 'pending' as const,
  }));

  const { data: upserted, error } = await service
    .from('attendance_exceptions')
    .upsert(rows, { onConflict: 'employee_id,exception_date', ignoreDuplicates: false })
    .select('id, employee_id, exception_date');
  if (error || !upserted) return result;

  const ids = upserted.map((r) => r.id);
  const { data: reminders } = await service
    .from('escalation_reminders')
    .select('target_id, reminder_count')
    .eq('target_type', 'attendance_exception_unmarked')
    .in('target_id', ids);
  const countById = new Map((reminders ?? []).map((r) => [r.target_id, r.reminder_count]));

  for (const r of upserted) {
    result.set(exceptionKey(r.employee_id, r.exception_date), { id: r.id, reminderCount: countById.get(r.id) ?? 0 });
  }
  return result;
}

export async function respondToAttendanceException(
  service: SupabaseClient,
  input: RespondToAttendanceExceptionInput
): Promise<RespondResult> {
  if (!input.note || !input.note.trim()) {
    return { ok: false, error: 'A note is required, whichever option you choose.' };
  }

  const { data: exception, error: fetchError } = await service
    .from('attendance_exceptions')
    .select('id, employee_id, exception_date, exception_type, first_punch, last_punch, resolution, employee_choice')
    .eq('id', input.exceptionId)
    .maybeSingle<ExceptionRow>();
  if (fetchError || !exception) return { ok: false, error: fetchError?.message ?? 'Attendance exception not found.' };
  if (exception.employee_id !== input.employeeId) {
    return { ok: false, error: 'This attendance exception does not belong to you.' };
  }
  if (exception.employee_choice !== null) {
    return { ok: false, error: 'You have already responded to this day.' };
  }

  if (input.choice === 'missed_punch') {
    const { data: mp, error: mpError } = await service
      .from('missed_punch')
      .upsert(
        {
          employee_id: exception.employee_id,
          punch_date: exception.exception_date,
          first_punch: exception.first_punch,
          last_punch: exception.last_punch,
          note: input.note,
          recorded_by: exception.employee_id,
        },
        { onConflict: 'employee_id,punch_date' }
      )
      .select('id')
      .single();
    if (mpError) return { ok: false, error: mpError.message };

    const { error: updateError } = await service
      .from('attendance_exceptions')
      .update({
        employee_choice: 'missed_punch',
        employee_note: input.note,
        resolution: 'missed_punch',
        missed_punch_id: mp.id,
        resolved_by: exception.employee_id,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', exception.id);
    if (updateError) return { ok: false, error: updateError.message };

    return { ok: true, leaveRequestId: null, regularisationId: null };
  }

  if (input.choice === 'half_day') {
    if (!input.leaveTypeCode) {
      return { ok: false, error: 'Choose which leave type this half day should be recorded against.' };
    }
    const result = await applyLeavePolicyAndMutateBalance({
      employeeId: exception.employee_id,
      leaveTypeCode: input.leaveTypeCode,
      startDate: exception.exception_date,
      isHalfDay: true,
      reason: input.note,
      source: 'self_apply', // pending until the manager decides — routed to the employee's effective approver exactly like a normal self-apply
    });
    if (result.violation) return { ok: false, error: result.violation.reason };

    // Record exists now (leaves the "unmarked" list) even though it's
    // still awaiting manager approval — resolution stays 'pending';
    // employee_choice is what marks this as no longer unmarked (see
    // migration 0015 and attendanceExceptions.ts's detection queries).
    const { error: updateError } = await service
      .from('attendance_exceptions')
      .update({
        employee_choice: 'half_day',
        employee_note: input.note,
        leave_request_id: result.requestId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', exception.id);
    if (updateError) return { ok: false, error: updateError.message };

    return { ok: true, leaveRequestId: result.requestId, regularisationId: null };
  }

  // regularise
  const { id: regularisationId, error: regError } = await createEmployeeRegularisationRequest(service, {
    employeeId: exception.employee_id,
    date: exception.exception_date,
    reason: input.note,
  });
  if (regError) return { ok: false, error: regError };

  const { error: updateError } = await service
    .from('attendance_exceptions')
    .update({
      employee_choice: 'regularise',
      employee_note: input.note,
      regularisation_id: regularisationId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', exception.id);
  if (updateError) return { ok: false, error: updateError.message };

  return { ok: true, leaveRequestId: null, regularisationId };
}

// ---------------------------------------------------------------------
// sendEscalationReminder — shared by the daily cron sweep and the
// manual "Remind now" button (§C.5's "hybrid reminder delivery"). Both
// paths increment the exact same escalation_reminders row, keyed on
// (target_type, target_id), so there is never a second counter to
// reconcile between the automated and manual paths.
// ---------------------------------------------------------------------
export interface SendEscalationReminderResult {
  ok: boolean;
  error?: string;
  reminderCount?: number;
}

async function bumpEscalationReminder(
  service: SupabaseClient,
  targetType: EscalationTargetType,
  targetId: string
): Promise<{ reminderCount: number | null; error: string | null }> {
  const { data: existing } = await service
    .from('escalation_reminders')
    .select('id, reminder_count, acked_at')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .maybeSingle();

  if (existing?.acked_at) {
    return { reminderCount: existing.reminder_count, error: 'This has already been converted to LWP — no further reminders needed.' };
  }

  const nextCount = (existing?.reminder_count ?? 0) + 1;
  const { error } = await service.from('escalation_reminders').upsert(
    {
      target_type: targetType,
      target_id: targetId,
      reminder_count: nextCount,
      last_reminder_at: new Date().toISOString(),
    },
    { onConflict: 'target_type,target_id' }
  );
  if (error) return { reminderCount: null, error: error.message };
  return { reminderCount: nextCount, error: null };
}

export async function sendEscalationReminder(
  service: SupabaseClient,
  targetType: EscalationTargetType,
  targetId: string
): Promise<SendEscalationReminderResult> {
  if (targetType === 'attendance_exception_unmarked') {
    const { data: exception } = await service
      .from('attendance_exceptions')
      .select('employee_id, exception_date, employee_choice, resolution')
      .eq('id', targetId)
      .maybeSingle();
    if (!exception) return { ok: false, error: 'Attendance exception not found.' };
    if (exception.employee_choice !== null || exception.resolution !== 'pending') {
      return { ok: false, error: 'This day is no longer unmarked — nothing to remind about.' };
    }

    const { reminderCount, error } = await bumpEscalationReminder(service, targetType, targetId);
    if (error) return { ok: false, error };

    await insertLeaveNotification(service, {
      recipient_employee_id: exception.employee_id,
      type: 'leave_reminder',
      title: 'Reminder: please resolve your flagged attendance day',
      body: `${exception.exception_date} is still unmarked. Go to My Leave to record it as a missed punch, an actual half day, or request regularisation.`,
      leave_request_id: null,
    });

    return { ok: true, reminderCount: reminderCount ?? undefined };
  }

  // Stage B — pending manager approval. Reminds the manager (the
  // employee already knows; they're the ones waiting on someone else).
  if (targetType === 'leave_request_pending') {
    const { data: request } = await service
      .from('leave_requests')
      .select('id, employee_id, status, start_date, end_date, employees!leave_requests_employee_id_fkey(department, reporting_lead_id, full_name)')
      .eq('id', targetId)
      .maybeSingle();
    if (!request) return { ok: false, error: 'Leave request not found.' };
    if (request.status !== 'pending') return { ok: false, error: 'This request is no longer pending.' };

    const emp = Array.isArray(request.employees) ? request.employees[0] : request.employees;
    const { approverId } = await getEffectiveApproverId(service, {
      department: emp?.department ?? null,
      reporting_lead_id: emp?.reporting_lead_id ?? null,
    });
    if (!approverId) return { ok: false, error: 'No approver is configured for this employee.' };

    const { reminderCount, error } = await bumpEscalationReminder(service, targetType, targetId);
    if (error) return { ok: false, error };

    await insertLeaveNotification(service, {
      recipient_employee_id: approverId,
      type: 'leave_reminder',
      title: `Reminder: ${emp?.full_name ?? 'an employee'}'s half-day request is waiting on you`,
      body: `A half-day request for ${request.start_date} is still pending your decision.`,
      leave_request_id: request.id,
    });

    return { ok: true, reminderCount: reminderCount ?? undefined };
  }

  // regularisation_pending
  const { data: reg } = await service
    .from('leave_regularisations')
    .select('id, employee_id, status, regularised_date, employees!leave_regularisations_employee_id_fkey(department, reporting_lead_id, full_name)')
    .eq('id', targetId)
    .maybeSingle();
  if (!reg) return { ok: false, error: 'Regularisation request not found.' };
  if (reg.status !== 'pending') return { ok: false, error: 'This request is no longer pending.' };

  const emp = Array.isArray(reg.employees) ? reg.employees[0] : reg.employees;
  const { approverId } = await getEffectiveApproverId(service, {
    department: emp?.department ?? null,
    reporting_lead_id: emp?.reporting_lead_id ?? null,
  });
  if (!approverId) return { ok: false, error: 'No approver is configured for this employee.' };

  const { reminderCount, error } = await bumpEscalationReminder(service, targetType, targetId);
  if (error) return { ok: false, error };

  await insertLeaveNotification(service, {
    recipient_employee_id: approverId,
    type: 'leave_reminder',
    title: `Reminder: ${emp?.full_name ?? 'an employee'}'s regularisation request is waiting on you`,
    body: `A regularisation request for ${reg.regularised_date} is still pending your decision.`,
    leave_request_id: null,
  });

  return { ok: true, reminderCount: reminderCount ?? undefined };
}

// ---------------------------------------------------------------------
// ackEscalationToLwp — HR's ACK action (§C.4). The only way HR ever
// finalizes an outcome themselves, and it always results in LWP — HR
// can never approve a half-day or regularisation on someone else's
// behalf. Gated on reminder_count >= 3 for the target.
// ---------------------------------------------------------------------
export interface AckResult {
  ok: boolean;
  error?: string;
  leaveRequestId?: string | null;
}

export async function ackEscalationToLwp(
  service: SupabaseClient,
  targetType: EscalationTargetType,
  targetId: string,
  ackedBy: string
): Promise<AckResult> {
  const { data: reminder } = await service
    .from('escalation_reminders')
    .select('id, reminder_count, acked_at')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .maybeSingle();
  if (!reminder) return { ok: false, error: 'No reminders have been sent for this yet.' };
  if (reminder.acked_at) return { ok: false, error: 'This has already been converted to LWP.' };
  if (reminder.reminder_count < 3) {
    return { ok: false, error: `ACK is only available after 3 reminders (currently ${reminder.reminder_count}).` };
  }

  const ackNow = async () =>
    service.from('escalation_reminders').update({ acked_by: ackedBy, acked_at: new Date().toISOString() }).eq('id', reminder.id);

  if (targetType === 'attendance_exception_unmarked') {
    const { data: exception } = await service
      .from('attendance_exceptions')
      .select('id, employee_id, exception_date, employee_choice, resolution')
      .eq('id', targetId)
      .maybeSingle();
    if (!exception) return { ok: false, error: 'Attendance exception not found.' };
    if (exception.employee_choice !== null || exception.resolution !== 'pending') {
      return { ok: false, error: 'This day is no longer unmarked.' };
    }

    const { requestId, error } = await createSystemAutoLwpRequest(service, {
      employeeId: exception.employee_id,
      date: exception.exception_date,
      isHalfDay: false,
      reason: 'Auto-converted to Leave Without Pay — no response after 3 reminders.',
    });
    if (error) return { ok: false, error };

    await service
      .from('attendance_exceptions')
      .update({
        resolution: 'lwp',
        leave_request_id: requestId,
        resolved_by: ackedBy,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', exception.id);

    await ackNow();
    return { ok: true, leaveRequestId: requestId };
  }

  if (targetType === 'leave_request_pending') {
    const { requestId, error } = await convertPendingRequestToAutoLwp(
      service,
      targetId,
      'Auto-converted to Leave Without Pay — manager did not decide after 3 reminders.'
    );
    if (error) return { ok: false, error };

    await service
      .from('attendance_exceptions')
      .update({ resolution: 'lwp', updated_at: new Date().toISOString() })
      .eq('leave_request_id', targetId);

    await ackNow();
    return { ok: true, leaveRequestId: requestId };
  }

  // regularisation_pending
  const { data: reg } = await service
    .from('leave_regularisations')
    .select('id, employee_id, regularised_date, status')
    .eq('id', targetId)
    .maybeSingle();
  if (!reg) return { ok: false, error: 'Regularisation request not found.' };
  if (reg.status !== 'pending') return { ok: false, error: 'This request is no longer pending.' };

  const { requestId, error } = await createSystemAutoLwpRequest(service, {
    employeeId: reg.employee_id,
    date: reg.regularised_date,
    isHalfDay: false,
    reason: 'Auto-converted to Leave Without Pay — manager did not decide after 3 reminders.',
  });
  if (error) return { ok: false, error };

  await service.from('leave_regularisations').update({ status: 'rejected' }).eq('id', reg.id);
  await service
    .from('attendance_exceptions')
    .update({ resolution: 'lwp', leave_request_id: requestId, updated_at: new Date().toISOString() })
    .eq('regularisation_id', targetId);

  await ackNow();
  return { ok: true, leaveRequestId: requestId };
}

// ---------------------------------------------------------------------
// Manager-rejection auto-LWP for regularisations (§C.5) — the
// leave_requests counterpart (applyAutoLwpForRejectedRequest) lives
// directly inside applyLeavePolicyAndMutateBalance.ts's own
// rejectExistingRequest, since that's the only function allowed to
// write leave_requests rows (see that file's header comment).
// leave_regularisations isn't a leave_requests row at all, so this one
// has no such constraint, but it's kept alongside the LWP-writing
// helpers in that same file rather than duplicated here. Re-exported so
// the regularisation reject route can import everything Part-C-related
// from this one module.
// ---------------------------------------------------------------------
export { applyAutoLwpForRejectedRegularisation } from './applyLeavePolicyAndMutateBalance';

// ---------------------------------------------------------------------
// Sweep — called by the daily cron job (see app/api/leave/admin/jobs)
// to find every due target across both stages and fire
// sendEscalationReminder for it. "Due" here just means "still open" —
// the reminder itself is what advances reminder_count; there is no
// separate cooldown window beyond "once per cron run," matching the
// existing pending-leave-reminders job's own once-per-day cadence.
// ---------------------------------------------------------------------
export interface EscalationSweepResult {
  targetType: EscalationTargetType;
  targetId: string;
  sent: boolean;
  reason: string;
}

export async function runEscalationSweep(service: SupabaseClient): Promise<EscalationSweepResult[]> {
  const results: EscalationSweepResult[] = [];

  const { data: unmarked } = await service
    .from('attendance_exceptions')
    .select('id')
    .eq('resolution', 'pending')
    .is('employee_choice', null);
  for (const row of unmarked ?? []) {
    const outcome = await sendEscalationReminder(service, 'attendance_exception_unmarked', row.id);
    results.push({
      targetType: 'attendance_exception_unmarked',
      targetId: row.id,
      sent: outcome.ok,
      reason: outcome.ok ? `Reminder ${outcome.reminderCount} sent` : outcome.error ?? 'Unknown error',
    });
  }

  const { data: pendingHalfDays } = await service
    .from('attendance_exceptions')
    .select('leave_request_id')
    .eq('employee_choice', 'half_day')
    .not('leave_request_id', 'is', null);
  for (const row of pendingHalfDays ?? []) {
    if (!row.leave_request_id) continue;
    const outcome = await sendEscalationReminder(service, 'leave_request_pending', row.leave_request_id);
    results.push({
      targetType: 'leave_request_pending',
      targetId: row.leave_request_id,
      sent: outcome.ok,
      reason: outcome.ok ? `Reminder ${outcome.reminderCount} sent` : outcome.error ?? 'Unknown error',
    });
  }

  const { data: pendingRegularisations } = await service
    .from('attendance_exceptions')
    .select('regularisation_id')
    .eq('employee_choice', 'regularise')
    .not('regularisation_id', 'is', null);
  for (const row of pendingRegularisations ?? []) {
    if (!row.regularisation_id) continue;
    const outcome = await sendEscalationReminder(service, 'regularisation_pending', row.regularisation_id);
    results.push({
      targetType: 'regularisation_pending',
      targetId: row.regularisation_id,
      sent: outcome.ok,
      reason: outcome.ok ? `Reminder ${outcome.reminderCount} sent` : outcome.error ?? 'Unknown error',
    });
  }

  return results;
}
