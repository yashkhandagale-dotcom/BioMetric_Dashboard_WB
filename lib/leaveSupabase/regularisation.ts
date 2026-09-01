import type { SupabaseClient } from '@supabase/supabase-js';
import { insertLeaveNotification } from './notifyLeaveEvent';
import { getEffectiveApproverId } from './organization';

// =====================================================================
// Leave Regularisation (feedback item #2) — a manager marks a specific
// day for one of their reports as "regularised" with a note (e.g. "left
// early for a client meeting, approved in advance"). Deliberately
// standalone from leave_requests/leave_balances — same reasoning as
// workforce_events: this is an attendance annotation the manager makes
// unilaterally, not something that goes through its own approval flow
// (the manager doing it IS the approval) and it never debits a leave
// balance.
// =====================================================================

export interface RegularisationInput {
  employeeId: string;
  date: string;
  reason: string;
  regularisedBy: string; // acting manager's employees.id
}

export interface RegularisationRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  date: string;
  reason: string;
  regularisedByName: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string | null;
}

export async function createRegularisation(
  supabase: SupabaseClient,
  input: RegularisationInput
): Promise<{ id: string | null; error: string | null }> {
  if (!input.reason.trim()) {
    return { id: null, error: 'A reason/note is required to regularise a day.' };
  }

  const { data, error } = await supabase
    .from('leave_regularisations')
    .upsert(
      {
        employee_id: input.employeeId,
        regularised_date: input.date,
        reason: input.reason,
        regularised_by: input.regularisedBy,
      },
      { onConflict: 'employee_id,regularised_date' }
    )
    .select('id')
    .single();

  if (error || !data) return { id: null, error: error?.message ?? 'Could not save regularisation.' };

  // Best-effort notification to the employee — mirrors the pattern in
  // notifyLeaveEvent.ts (a delivery failure here must not roll back the
  // regularisation itself).
  await insertLeaveNotification(supabase, {
    recipient_employee_id: input.employeeId,
    type: 'leave_reminder', // reuses the existing notification type vocabulary; regularisation has no dedicated type of its own yet
    title: 'Your day was regularised',
    body: `${input.date} was marked as regularised by your manager: ${input.reason}`,
    leave_request_id: null,
  });

  return { id: data.id, error: null };
}

export async function listRegularisationsForEmployees(
  supabase: SupabaseClient,
  employeeIds: string[]
): Promise<{ rows: RegularisationRow[]; error: string | null }> {
  if (employeeIds.length === 0) return { rows: [], error: null };

  const { data, error } = await supabase
    .from('leave_regularisations')
    .select(
      `id, regularised_date, reason, created_at, status, requested_by, employee_id, regularised_by,
       employees:employees!leave_regularisations_employee_id_fkey ( id, full_name, employee_code ),
       regularised_by_employee:employees!leave_regularisations_regularised_by_fkey ( full_name )`
    )
    .in('employee_id', employeeIds)
    .order('regularised_date', { ascending: false });

  if (error) return { rows: [], error: error.message };

  type Row = {
    id: string;
    regularised_date: string;
    reason: string;
    created_at: string;
    status: 'pending' | 'approved' | 'rejected';
    requested_by: string | null;
    employees: { id: string; full_name: string; employee_code: string } | { id: string; full_name: string; employee_code: string }[] | null;
    regularised_by_employee: { full_name: string } | { full_name: string }[] | null;
  };

  const firstOf = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

  return {
    rows: ((data ?? []) as unknown as Row[])
      .map((r) => {
        const emp = firstOf(r.employees);
        const by = firstOf(r.regularised_by_employee);
        if (!emp) return null;
        return {
          id: r.id,
          employeeId: emp.id,
          employeeName: emp.full_name,
          employeeCode: emp.employee_code,
          date: r.regularised_date,
          reason: r.reason,
          regularisedByName: by?.full_name ?? 'Unknown',
          createdAt: r.created_at,
          status: r.status,
          requestedBy: r.requested_by,
        };
      })
      .filter((r): r is RegularisationRow => r !== null),
    error: null,
  };
}

export async function listMyRegularisationRequests(
  supabase: SupabaseClient,
  employeeId: string
): Promise<{ rows: RegularisationRow[]; error: string | null }> {
  return listRegularisationsForEmployees(supabase, [employeeId]);
}

// =====================================================================
// Employee-initiated regularisation (Part C, §C.2's "Early leave /
// regularise" option) — a new direction on the same table. Unlike
// createRegularisation above (manager-unilateral, "the manager doing it
// IS the approval", status defaults 'approved'), this creates a
// status='pending' row with requested_by = the employee, and needs an
// explicit manager decision through approveEmployeeRegularisationRequest
// / rejectEmployeeRegularisationRequest below before it's resolved.
// =====================================================================

export async function createEmployeeRegularisationRequest(
  supabase: SupabaseClient,
  input: { employeeId: string; date: string; reason: string }
): Promise<{ id: string | null; error: string | null }> {
  if (!input.reason.trim()) {
    return { id: null, error: 'A note is required to request regularisation for this day.' };
  }

  const { data, error } = await supabase
    .from('leave_regularisations')
    .upsert(
      {
        employee_id: input.employeeId,
        regularised_date: input.date,
        reason: input.reason,
        // regularised_by is not-null at the DB level; for an
        // employee-initiated row it's reassigned to the approving
        // manager on approval (approveEmployeeRegularisationRequest
        // below) — until then it's a placeholder pointing at the
        // employee themselves, never read as "approved by" while
        // status='pending'.
        regularised_by: input.employeeId,
        requested_by: input.employeeId,
        status: 'pending',
      },
      { onConflict: 'employee_id,regularised_date' }
    )
    .select('id')
    .single();

  if (error || !data) return { id: null, error: error?.message ?? 'Could not save this regularisation request.' };

  const { data: employee } = await supabase
    .from('employees')
    .select('full_name, department, reporting_lead_id')
    .eq('id', input.employeeId)
    .maybeSingle();
  if (employee) {
    const { approverId } = await getEffectiveApproverId(supabase, {
      department: employee.department,
      reporting_lead_id: employee.reporting_lead_id,
    });
    if (approverId) {
      await insertLeaveNotification(supabase, {
        recipient_employee_id: approverId,
        type: 'leave_reminder',
        title: `${employee.full_name} requested a day be regularised`,
        body: `${employee.full_name} asked to regularise ${input.date}: ${input.reason}`,
        leave_request_id: null,
      });
    }
  }

  return { id: data.id, error: null };
}

export interface RegularisationDecisionResult {
  id: string | null;
  error: string | null;
}

export async function approveEmployeeRegularisationRequest(
  supabase: SupabaseClient,
  regularisationId: string,
  approverId: string
): Promise<RegularisationDecisionResult> {
  const { data: existing, error: fetchError } = await supabase
    .from('leave_regularisations')
    .select('id, employee_id, regularised_date, reason, status')
    .eq('id', regularisationId)
    .single();
  if (fetchError || !existing) return { id: null, error: fetchError?.message ?? 'Regularisation request not found.' };
  if (existing.status !== 'pending') {
    return { id: regularisationId, error: `Cannot approve a request in status '${existing.status}'.` };
  }

  const { error: updateError } = await supabase
    .from('leave_regularisations')
    .update({ status: 'approved', regularised_by: approverId })
    .eq('id', regularisationId);
  if (updateError) return { id: regularisationId, error: updateError.message };

  await insertLeaveNotification(supabase, {
    recipient_employee_id: existing.employee_id,
    type: 'leave_reminder',
    title: 'Your regularisation request was approved',
    body: `${existing.regularised_date} was approved as regularised: ${existing.reason}`,
    leave_request_id: null,
  });

  return { id: regularisationId, error: null };
}

export async function rejectEmployeeRegularisationRequest(
  supabase: SupabaseClient,
  regularisationId: string,
  comment: string
): Promise<RegularisationDecisionResult> {
  if (!comment.trim()) return { id: regularisationId, error: 'A short comment is required to reject.' };

  const { data: existing, error: fetchError } = await supabase
    .from('leave_regularisations')
    .select('id, employee_id, regularised_date, status')
    .eq('id', regularisationId)
    .single();
  if (fetchError || !existing) return { id: null, error: fetchError?.message ?? 'Regularisation request not found.' };
  if (existing.status !== 'pending') {
    return { id: regularisationId, error: `Cannot reject a request in status '${existing.status}'.` };
  }

  const { error: updateError } = await supabase
    .from('leave_regularisations')
    .update({ status: 'rejected' })
    .eq('id', regularisationId);
  if (updateError) return { id: regularisationId, error: updateError.message };

  await insertLeaveNotification(supabase, {
    recipient_employee_id: existing.employee_id,
    type: 'leave_reminder',
    title: 'Your regularisation request was rejected',
    body: `Your request to regularise ${existing.regularised_date} was rejected. Reason: ${comment}`,
    leave_request_id: null,
  });

  return { id: regularisationId, error: null };
}
