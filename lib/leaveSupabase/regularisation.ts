import type { SupabaseClient } from '@supabase/supabase-js';
import { insertLeaveNotification } from './notifyLeaveEvent';

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
      `id, regularised_date, reason, created_at,
       employees:employee_id ( id, full_name, employee_code ),
       regularised_by_employee:regularised_by ( full_name )`
    )
    .in('employee_id', employeeIds)
    .order('regularised_date', { ascending: false });

  if (error) return { rows: [], error: error.message };

  type Row = {
    id: string;
    regularised_date: string;
    reason: string;
    created_at: string;
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
        };
      })
      .filter((r): r is RegularisationRow => r !== null),
    error: null,
  };
}
