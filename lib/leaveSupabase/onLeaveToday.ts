import type { SupabaseClient } from '@supabase/supabase-js';

// =====================================================================
// Feedback item #1 — "KPI cards for HR to view employees who are on
// pre-approved leave today" + item #13's "who's on leave today /
// pre-approved leave" manager tab. One shared read so the HR dashboard
// KPI card and the manager's Team tab never disagree about who counts.
//
// "Pre-approved" = status in ('approved', 'auto_lwp') and today's date
// falls within [start_date, end_date] — pending requests don't count
// (they're not approved yet), same status set getEmployeeAttendanceKPIs
// already treats as "actually on leave".
// =====================================================================

export interface OnLeaveTodayRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  leaveTypeCode: string;
  leaveTypeLabel: string;
  isHalfDay: boolean;
  halfDaySession: string | null;
  startDate: string;
  endDate: string;
}

export async function getEmployeesOnLeaveToday(
  supabase: SupabaseClient,
  date: string = new Date().toISOString().slice(0, 10),
  employeeIds?: string[]
): Promise<{ rows: OnLeaveTodayRow[]; error: string | null }> {
  let query = supabase
    .from('leave_requests')
    .select(
      `id, is_half_day, half_day_session, start_date, end_date,
       employees!leave_requests_employee_id_fkey ( id, full_name, employee_code, department, office ),
       leave_types ( code, display_name )`
    )
    .in('status', ['approved', 'auto_lwp'])
    .lte('start_date', date)
    .gte('end_date', date);

  if (employeeIds && employeeIds.length > 0) {
    query = query.in('employee_id', employeeIds);
  }

  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };

  type Row = {
    is_half_day: boolean;
    half_day_session: string | null;
    start_date: string;
    end_date: string;
    employees: { id: string; full_name: string; employee_code: string; department: string; office: string } | { id: string; full_name: string; employee_code: string; department: string; office: string }[] | null;
    leave_types: { code: string; display_name: string } | { code: string; display_name: string }[] | null;
  };

  const firstOf = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

  const rows = ((data ?? []) as unknown as Row[])
    .map((r) => {
      const emp = firstOf(r.employees);
      const lt = firstOf(r.leave_types);
      if (!emp || !lt) return null;
      return {
        employeeId: emp.id,
        employeeName: emp.full_name,
        employeeCode: emp.employee_code,
        department: emp.department,
        office: emp.office,
        leaveTypeCode: lt.code,
        leaveTypeLabel: lt.display_name,
        isHalfDay: r.is_half_day,
        halfDaySession: r.half_day_session,
        startDate: r.start_date,
        endDate: r.end_date,
      };
    })
    .filter((r): r is OnLeaveTodayRow => r !== null);

  return { rows, error: null };
}
