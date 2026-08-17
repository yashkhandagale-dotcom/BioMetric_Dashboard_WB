import type { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveApproverId } from './organization';
import { insertLeaveNotification } from './notifyLeaveEvent';

// =====================================================================
// WFH application + approval (feedback items #5/#6).
//
// wfh_requests is a real pending -> approved/rejected/cancelled workflow
// (migration 0012), separate from workforce_events (which stays a plain
// marker table — see its own header comment: no FK/workflow, used for
// HR bulk-entry). On approval here, this module writes the matching
// workforce_events row(s) so every existing reader of workforce_events
// (app/api/dashboard/workforce-events, lib/leaveTrackerRead.ts) picks up
// an approved WFH day automatically, with zero changes on that side.
//
// Approval routing reuses getEffectiveApproverId — the SAME function
// leave uses. For an employee in the Delivery department, the
// department's assigned manager (department_managers) IS the "Delivery
// Manager" per the confirmed product decision — no separate role/table
// was introduced for this.
// =====================================================================

export type WfhStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface WfhApplyInput {
  employeeId: string;
  startDate: string;
  endDate?: string | null;
  isHalfDay: boolean;
  halfDaySession?: 'AM' | 'PM';
  reason: string;
}

export interface WfhRequestResult {
  id: string | null;
  error: string | null;
}

function daysBetweenInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

export async function applyForWfh(supabase: SupabaseClient, input: WfhApplyInput): Promise<WfhRequestResult> {
  if (!input.reason.trim()) return { id: null, error: 'A reason is required to apply for WFH.' };
  const endDate = input.isHalfDay ? input.startDate : input.endDate || input.startDate;
  if (new Date(`${endDate}T00:00:00Z`) < new Date(`${input.startDate}T00:00:00Z`)) {
    return { id: null, error: 'End date cannot be before start date.' };
  }

  const { data: created, error: insertError } = await supabase
    .from('wfh_requests')
    .insert({
      employee_id: input.employeeId,
      start_date: input.startDate,
      end_date: endDate,
      is_half_day: !!input.isHalfDay,
      half_day_session: input.isHalfDay ? input.halfDaySession : null,
      reason: input.reason,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertError || !created) return { id: null, error: insertError?.message ?? 'Could not submit WFH request.' };

  await notifyWfhSubmitted(supabase, created.id, input.employeeId);
  return { id: created.id, error: null };
}

async function getEmployeeForRouting(supabase: SupabaseClient, employeeId: string) {
  const { data } = await supabase
    .from('employees')
    .select('id, full_name, department, reporting_lead_id')
    .eq('id', employeeId)
    .single();
  return data as { id: string; full_name: string; department: string; reporting_lead_id: string | null } | null;
}

async function notifyWfhSubmitted(supabase: SupabaseClient, requestId: string, employeeId: string) {
  const employee = await getEmployeeForRouting(supabase, employeeId);
  if (!employee) return;
  const { approverId } = await getEffectiveApproverId(supabase, {
    department: employee.department,
    reporting_lead_id: employee.reporting_lead_id,
  });
  if (!approverId) return;
  await insertLeaveNotification(supabase, {
    recipient_employee_id: approverId,
    type: 'wfh_submitted',
    title: `${employee.full_name} applied for Work From Home`,
    body: `${employee.full_name} requested WFH — review it on the Approvals page.`,
    leave_request_id: requestId,
  });
}

export async function approveWfhRequest(
  supabase: SupabaseClient,
  requestId: string,
  approverId: string
): Promise<WfhRequestResult> {
  const { data: existing, error: fetchError } = await supabase
    .from('wfh_requests')
    .select('*')
    .eq('id', requestId)
    .single();
  if (fetchError || !existing) return { id: null, error: fetchError?.message ?? 'WFH request not found.' };
  if (existing.status !== 'pending') {
    return { id: requestId, error: `Cannot approve a request in status '${existing.status}'.` };
  }

  const { error: updateError } = await supabase
    .from('wfh_requests')
    .update({ status: 'approved', approver_id: approverId, updated_at: new Date().toISOString() })
    .eq('id', requestId);
  if (updateError) return { id: requestId, error: updateError.message };

  // Write the matching workforce_events row(s) — one per calendar day in
  // range — so every existing reader (dashboard, attendance KPIs) sees
  // this as WFH with no changes on their side. unique(employee_id,
  // event_date, event_type) means this is safely re-runnable.
  const dates = daysBetweenInclusive(existing.start_date, existing.end_date);
  const rows = dates.map((date) => ({
    employee_id: existing.employee_id,
    event_type: 'wfh',
    event_date: date,
    note: `WFH request approved (wfh_requests ${requestId})${existing.is_half_day ? ` — half day (${existing.half_day_session ?? ''})` : ''}`,
    created_by: approverId,
  }));
  if (rows.length > 0) {
    const { error: eventError } = await supabase.from('workforce_events').upsert(rows, {
      onConflict: 'employee_id,event_date,event_type',
    });
    if (eventError) {
      // The status flip already succeeded; surface the event-write
      // problem but don't roll the approval back — an HR admin can
      // re-run this via the same route, which is idempotent (upsert).
      return { id: requestId, error: `Approved, but could not record attendance event: ${eventError.message}` };
    }
  }

  const employee = await getEmployeeForRouting(supabase, existing.employee_id);
  if (employee) {
    await insertLeaveNotification(supabase, {
      recipient_employee_id: employee.id,
      type: 'wfh_approved',
      title: 'Your WFH request was approved',
      body: `Your WFH request for ${existing.start_date === existing.end_date ? existing.start_date : `${existing.start_date} to ${existing.end_date}`} was approved.`,
      leave_request_id: requestId,
    });
  }

  return { id: requestId, error: null };
}

export async function rejectWfhRequest(
  supabase: SupabaseClient,
  requestId: string,
  approverId: string,
  comment: string
): Promise<WfhRequestResult> {
  if (!comment.trim()) return { id: requestId, error: 'A short comment is required to reject.' };

  const { data: existing, error: fetchError } = await supabase
    .from('wfh_requests')
    .select('employee_id, start_date, end_date, status')
    .eq('id', requestId)
    .single();
  if (fetchError || !existing) return { id: null, error: fetchError?.message ?? 'WFH request not found.' };
  if (existing.status !== 'pending') {
    return { id: requestId, error: `Cannot reject a request in status '${existing.status}'.` };
  }

  const { error: updateError } = await supabase
    .from('wfh_requests')
    .update({ status: 'rejected', approver_id: approverId, rejection_comment: comment, updated_at: new Date().toISOString() })
    .eq('id', requestId);
  if (updateError) return { id: requestId, error: updateError.message };

  await insertLeaveNotification(supabase, {
    recipient_employee_id: existing.employee_id,
    type: 'wfh_rejected',
    title: 'Your WFH request was rejected',
    body: `Your WFH request for ${existing.start_date === existing.end_date ? existing.start_date : `${existing.start_date} to ${existing.end_date}`} was rejected. Reason: ${comment}. You can apply for a different leave type instead if applicable.`,
    leave_request_id: requestId,
  });

  return { id: requestId, error: null };
}

export async function cancelWfhRequest(supabase: SupabaseClient, requestId: string, actingEmployeeId: string): Promise<WfhRequestResult> {
  const { data: existing, error: fetchError } = await supabase
    .from('wfh_requests')
    .select('employee_id, status, start_date, end_date')
    .eq('id', requestId)
    .single();
  if (fetchError || !existing) return { id: null, error: fetchError?.message ?? 'WFH request not found.' };
  if (existing.employee_id !== actingEmployeeId) {
    return { id: requestId, error: 'You can only cancel your own WFH request.' };
  }
  if (existing.status === 'cancelled' || existing.status === 'rejected') {
    return { id: requestId, error: `Request is already '${existing.status}' — nothing to cancel.` };
  }

  const wasApproved = existing.status === 'approved';

  const { error: updateError } = await supabase
    .from('wfh_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', requestId);
  if (updateError) return { id: requestId, error: updateError.message };

  if (wasApproved) {
    // Remove the workforce_events rows this approval created, so
    // cancelling a WFH day also clears it from attendance/dashboard
    // views — same as leave cancellation crediting the balance back.
    const dates = daysBetweenInclusive(existing.start_date, existing.end_date);
    await supabase
      .from('workforce_events')
      .delete()
      .eq('employee_id', existing.employee_id)
      .eq('event_type', 'wfh')
      .in('event_date', dates);
  }

  return { id: requestId, error: null };
}
