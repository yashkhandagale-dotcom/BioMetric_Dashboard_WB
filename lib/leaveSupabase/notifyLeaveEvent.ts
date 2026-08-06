import type { SupabaseClient } from '@supabase/supabase-js';

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
  | 'leave_cancelled';

export interface LeaveEvent {
  type: 'submitted' | 'approved' | 'rejected' | 'cancelled';
  requestId: string;
  employeeId: string;
  source: 'self_apply' | 'manager_approval' | 'manager_reject' | 'hr_manual' | 'cancellation';
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
}

type EmployeeRow = {
  id: string;
  full_name: string;
  department: string;
  reporting_manager_id: string | null;
  reporting_lead_id: string | null;
};

function dateRangeLabel(start?: string, end?: string): string {
  if (!start) return '';
  return start === end || !end ? start : `${start} to ${end}`;
}

async function insertNotifications(
  service: SupabaseClient,
  rows: { recipient_employee_id: string; type: LeaveNotificationType; title: string; body: string; leave_request_id: string }[]
): Promise<void> {
  if (rows.length === 0) return;
  // De-dupe recipients (e.g. an HR employee who is also the acting
  // manager shouldn't get two rows for the same event).
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const key = `${r.recipient_employee_id}__${r.type}__${r.leave_request_id}`;
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
    if (employee.reporting_manager_id) {
      const flag = event.violationNote ? ` — policy flag: ${event.violationNote}` : '';
      rows.push({
        recipient_employee_id: employee.reporting_manager_id,
        type: 'leave_submitted',
        title: `${employee.full_name} applied for leave`,
        body: `${employee.full_name} requested leave${range ? ` for ${range}` : ''}.${flag}`,
        leave_request_id: event.requestId,
      });
    }
    // EMAIL: send to manager's email here once a provider is wired up.
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

  const recipientIds = new Set<string>();
  recipientIds.add(employee.id);
  if (employee.reporting_manager_id) recipientIds.add(employee.reporting_manager_id);
  if (employee.reporting_lead_id) recipientIds.add(employee.reporting_lead_id);
  for (const hr of hrEmployees ?? []) recipientIds.add(hr.id);

  if (isWideBroadcast) {
    const { data: team } = await service
      .from('employees')
      .select('id')
      .eq('reporting_manager_id', employee.reporting_manager_id ?? '__none__');
    for (const t of team ?? []) recipientIds.add(t.id);
  }

  const type: LeaveNotificationType = event.type === 'approved' ? 'leave_approved' : 'leave_cancelled';
  const verb = event.type === 'approved' ? 'approved' : 'cancelled';
  const lwpNote = event.convertedToLwp ? ' (recorded as Leave Without Pay due to insufficient balance)' : '';

  for (const id of recipientIds) {
    rows.push({
      recipient_employee_id: id,
      type,
      title: id === employee.id ? `Your leave request was ${verb}` : `${employee.full_name}'s leave was ${verb}`,
      body: `${employee.full_name}'s leave${range ? ` for ${range}` : ''} was ${verb}${lwpNote}.`,
      leave_request_id: event.requestId,
    });
  }

  // EMAIL: send to each recipient's email here once a provider is wired up.
  await insertNotifications(service, rows);
}