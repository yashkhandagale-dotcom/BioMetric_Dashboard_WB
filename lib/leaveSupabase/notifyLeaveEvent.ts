import type { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveApproverId } from './organization';

// =====================================================================
// notifyLeaveEvent — real implementation, replacing the no-op stub that
// used to live at the bottom of applyLeavePolicyAndMutateBalance.ts
// (see that file's own comment, and PROGRESS.md's "notifyLeaveEvent() —
// Part 3 doesn't exist in this codebase yet" entry, for why it was a
// stub up to this point).
//
// Implements LEAVE_TRACKER_OVERHAUL_PLAN.md section 6's notification
// matrix exactly:
//
//   | Event                              | Recipients                        | Scope  |
//   |-------------------------------------|-----------------------------------|--------|
//   | Employee applies                    | Manager (+ violation flag)        | —      |
//   | Manager approves — Planned/Casual    | Employee, HR, Lead, whole team    | Wide   |
//   | Manager approves — Sick/LWP/Half-day | Employee, HR, Lead, Manager       | Narrow |
//   | Manager rejects                     | Employee (+ reason)               | —      |
//   | Request cancelled                   | Employee, Manager, HR, Lead       | Matches original scope |
//
// SCOPE DEVIATION (disclosed): the plan's confirmed assumption #4 says
// notifications should be "in-app + email from the start" (Sprint D).
// This function implements the in-app half only — a `notifications`
// table row per recipient (see the header comment on the migration this
// ships with). Email sending needs a provider (Resend/SendGrid/etc.)
// chosen and its API key added to .env, which is explicitly flagged in
// the plan as separate integration work for whoever picks the provider;
// there is no key available in this environment to wire that up for
// real, and a fake/no-op "email" call would be worse than just not
// claiming to send one. Every call site below is already exactly where
// an email send would be added later — see the `// EMAIL:` comments.
// =====================================================================

export type LeaveNotificationType =
  | 'leave_submitted'
  | 'leave_approved'
  | 'leave_rejected'
  | 'leave_cancelled'
  | 'leave_corrected'
  | 'leave_reminder'
  // WFH (feedback items #5/#6) reuses the notifications table rather
  // than a parallel one — same recipient-resolution helper
  // (getEffectiveApproverId), just its own type values so the UI can
  // tell a WFH notification apart from a leave one.
  | 'wfh_submitted'
  | 'wfh_approved'
  | 'wfh_rejected'
  | 'wfh_cancelled';

export interface LeaveEvent {
  type: 'submitted' | 'approved' | 'rejected' | 'cancelled' | 'corrected';
  requestId: string;
  employeeId: string;
  source: 'self_apply' | 'manager_approval' | 'manager_reject' | 'hr_manual' | 'cancellation' | 'hr_correction';
  convertedToLwp?: boolean;
  // Present on submitted/approved/rejected/cancelled — needed to decide
  // wide vs narrow broadcast scope (section 6). Optional because a hard
  // failure earlier in applyLeavePolicyAndMutateBalance may not have
  // resolved a leave type before bailing out — those paths never call
  // notifyLeaveEvent at all, so this is defensive, not expected null.
  leaveTypeCode?: 'SL' | 'CL' | 'PL' | 'LWP';
  isHalfDay?: boolean;
  rejectionComment?: string;
  startDate?: string;
  endDate?: string;
  violationNote?: string | null;
  // corrected only — HR's mandatory reason for reversing an
  // already-finished approved/auto_lwp request (see
  // applyLeavePolicyAndMutateBalance.ts's hrCorrectExistingRequest).
  correctionReason?: string;
}

type EmployeeRow = {
  id: string;
  full_name: string;
  department: string;
  reporting_manager_id: string | null;
  reporting_lead_id: string | null;
};

// NOTE: employees.reporting_manager_id is a manager's own reporting
// chain (who a manager-role row reports to), NOT "who is this regular
// employee's manager" — see organization.ts's getEffectiveApproverId for
// the full explanation. Every recipient-resolution below routes through
// that helper (department_managers, falling back to reporting_lead_id)
// instead of reading employee.reporting_manager_id directly, which used
// to mean a manager never got notified when their team applied for
// leave (the field is null for everyone but manager-role employees).

function dateRangeLabel(start?: string, end?: string): string {
  if (!start) return '';
  return start === end || !end ? start : `${start} to ${end}`;
}

// Exported single-row wrapper for callers outside this file that need to
// drop one notification without building the whole LeaveEvent shape —
// e.g. lib/leaveSupabase/regularisation.ts and wfhRequests.ts. Routes
// through the same de-dupe/best-effort insertNotifications below so
// there's exactly one write path into `notifications`.
export async function insertLeaveNotification(
  service: SupabaseClient,
  row: { recipient_employee_id: string; type: LeaveNotificationType; title: string; body: string; leave_request_id: string | null }
): Promise<void> {
  await insertNotifications(service, [row]);
}

async function insertNotifications(
  service: SupabaseClient,
  rows: { recipient_employee_id: string; type: LeaveNotificationType; title: string; body: string; leave_request_id: string | null }[]
): Promise<void> {
  if (rows.length === 0) return;
  // De-dupe recipients (e.g. an HR employee who is also the acting
  // manager shouldn't get two rows for the same event).
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const key = `${r.recipient_employee_id}__${r.type}__${r.leave_request_id ?? 'none'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const { error } = await service.from('notifications').insert(deduped);
  if (error) {
    // Notifications are best-effort — a delivery failure here must never
    // roll back or block the balance/status mutation that already
    // succeeded (the leave_requests/leave_balances write is the thing
    // that has to be correct; a missed notification row is recoverable,
    // an un-debited approved leave is not). Logged, not thrown.
    console.error('notifyLeaveEvent: failed to insert notifications:', error.message);
  }
}

export async function notifyLeaveEvent(service: SupabaseClient, event: LeaveEvent): Promise<void> {
  const { data: employee } = await service
    .from('employees')
    .select('id, full_name, department, reporting_manager_id, reporting_lead_id')
    .eq('id', event.employeeId)
    .single<EmployeeRow>();
  if (!employee) return;

  const range = dateRangeLabel(event.startDate, event.endDate);
  const rows: { recipient_employee_id: string; type: LeaveNotificationType; title: string; body: string; leave_request_id: string }[] = [];

  if (event.type === 'submitted') {
    const { approverId } = await getEffectiveApproverId(service, {
      department: employee.department,
      reporting_lead_id: employee.reporting_lead_id,
    });
    if (approverId) {
      const flag = event.violationNote ? ` — policy flag: ${event.violationNote}` : '';
      rows.push({
        recipient_employee_id: approverId,
        type: 'leave_submitted',
        title: `${employee.full_name} applied for leave`,
        body: `${employee.full_name} requested leave${range ? ` for ${range}` : ''}.${flag}`,
        leave_request_id: event.requestId,
      });
    }
    // EMAIL: send to the approver's email here once a provider is wired up.
    await insertNotifications(service, rows);
    return;
  }

  if (event.type === 'rejected') {
    rows.push({
      recipient_employee_id: employee.id,
      type: 'leave_rejected',
      title: 'Your leave request was rejected',
      body: `Your leave request${range ? ` for ${range}` : ''} was rejected.${event.rejectionComment ? ` Reason: ${event.rejectionComment}` : ''}`,
      leave_request_id: event.requestId,
    });
    // EMAIL: send to employee's email here once a provider is wired up.
    await insertNotifications(service, rows);
    return;
  }

  // approved / cancelled share the same recipient-resolution logic —
  // "matches original scope" for cancellation per the matrix's last row.
  const { data: hrEmployees } = await service.from('employees').select('id').in('role', ['hr', 'hr_super_admin']);

  const isWideBroadcast =
    !event.isHalfDay && (event.leaveTypeCode === 'PL' || event.leaveTypeCode === 'CL');

  const { approverId } = await getEffectiveApproverId(service, {
    department: employee.department,
    reporting_lead_id: employee.reporting_lead_id,
  });

  const recipientIds = new Set<string>();
  recipientIds.add(employee.id);
  if (approverId) recipientIds.add(approverId);
  if (employee.reporting_lead_id) recipientIds.add(employee.reporting_lead_id);
  for (const hr of hrEmployees ?? []) recipientIds.add(hr.id);

  if (isWideBroadcast && employee.department) {
    // "Whole team" = every other employee/lead in the same department
    // (the department's manager is the shared approver — mirrors
    // getManagedEmployeeIds's own definition of a manager's team).
    const { data: team } = await service
      .from('employees')
      .select('id')
      .eq('department', employee.department)
      .in('role', ['employee', 'lead']);
    for (const t of team ?? []) recipientIds.add(t.id);
  }

  const type: LeaveNotificationType =
    event.type === 'approved' ? 'leave_approved' : event.type === 'corrected' ? 'leave_corrected' : 'leave_cancelled';
  const verb = event.type === 'approved' ? 'approved' : event.type === 'corrected' ? 'reversed by HR' : 'cancelled';
  const lwpNote = event.convertedToLwp ? ' (recorded as Leave Without Pay due to insufficient balance)' : '';
  // corrected-only: HR's reason is required at the write boundary (see
  // hrCorrectExistingRequest), so it's always present here, but this
  // stays defensive rather than assuming.
  const reasonNote = event.type === 'corrected' && event.correctionReason ? ` Reason: ${event.correctionReason}` : '';

  for (const id of recipientIds) {
    rows.push({
      recipient_employee_id: id,
      type,
      title: id === employee.id ? `Your leave request was ${verb}` : `${employee.full_name}'s leave was ${verb}`,
      body: `${employee.full_name}'s leave${range ? ` for ${range}` : ''} was ${verb}${lwpNote}.${reasonNote}`,
      leave_request_id: event.requestId,
    });
  }

  // EMAIL: send to each recipient's email here once a provider is wired up.
  await insertNotifications(service, rows);
}

// =====================================================================
// sendLeaveReminder — "Send Reminder" action from the Pending Approvals
// queue and from the Leave Tracker's Absentees/Half Day tabs.
//
// Two shapes:
//   - pending_request: a request is sitting unapproved. Reminds BOTH the
//     employee (their request is still waiting) and the effective
//     approver (manager, or lead when the department has no manager).
//   - missing_application: a day was flagged as an unresolved absence
//     or possible half-day with no leave request filed at all. Reminds
//     the employee to apply, and lets the effective approver know
//     nothing has been filed yet for that date.
// =====================================================================
export type LeaveReminderInput =
  | { mode: 'pending_request'; requestId: string }
  | { mode: 'missing_application'; employeeId: string; date: string };

export async function sendLeaveReminder(
  service: SupabaseClient,
  input: LeaveReminderInput
): Promise<{ ok: boolean; error?: string }> {
  if (input.mode === 'pending_request') {
    const { data: request } = await service
      .from('leave_requests')
      .select('id, employee_id, start_date, end_date, status')
      .eq('id', input.requestId)
      .maybeSingle();
    if (!request) return { ok: false, error: 'Leave request not found.' };
    if (request.status !== 'pending') return { ok: false, error: 'This request is no longer pending.' };

    const { data: employee } = await service
      .from('employees')
      .select('id, full_name, department, reporting_lead_id')
      .eq('id', request.employee_id)
      .single<EmployeeRow>();
    if (!employee) return { ok: false, error: 'Employee not found.' };

    const { approverId } = await getEffectiveApproverId(service, {
      department: employee.department,
      reporting_lead_id: employee.reporting_lead_id,
    });
    const range = dateRangeLabel(request.start_date, request.end_date);

    const rows: { recipient_employee_id: string; type: LeaveNotificationType; title: string; body: string; leave_request_id: string | null }[] = [
      {
        recipient_employee_id: employee.id,
        type: 'leave_reminder',
        title: 'Reminder: your leave request is still pending',
        body: `Your leave request${range ? ` for ${range}` : ''} is still awaiting approval.`,
        leave_request_id: request.id,
      },
    ];
    if (approverId) {
      rows.push({
        recipient_employee_id: approverId,
        type: 'leave_reminder',
        title: `Reminder: ${employee.full_name}'s leave request is waiting on you`,
        body: `${employee.full_name}'s leave request${range ? ` for ${range}` : ''} is still pending your approval.`,
        leave_request_id: request.id,
      });
    }
    await insertNotifications(service, rows);
    return { ok: true };
  }

  // missing_application
  const { data: employee } = await service
    .from('employees')
    .select('id, full_name, department, reporting_lead_id')
    .eq('id', input.employeeId)
    .single<EmployeeRow>();
  if (!employee) return { ok: false, error: 'Employee not found.' };

  const { approverId } = await getEffectiveApproverId(service, {
    department: employee.department,
    reporting_lead_id: employee.reporting_lead_id,
  });

  const rows: { recipient_employee_id: string; type: LeaveNotificationType; title: string; body: string; leave_request_id: string | null }[] = [
    {
      recipient_employee_id: employee.id,
      type: 'leave_reminder',
      title: 'Reminder: apply for your leave',
      body: `You were marked absent/unresolved on ${input.date} with no leave application on file. Please apply for leave or contact HR if this is a mistake.`,
      leave_request_id: null,
    },
  ];
  if (approverId) {
    rows.push({
      recipient_employee_id: approverId,
      type: 'leave_reminder',
      title: `Reminder: ${employee.full_name} has an unrecorded absence`,
      body: `${employee.full_name} was absent on ${input.date} with no leave application filed yet.`,
      leave_request_id: null,
    });
  }
  await insertNotifications(service, rows);
  return { ok: true };
}