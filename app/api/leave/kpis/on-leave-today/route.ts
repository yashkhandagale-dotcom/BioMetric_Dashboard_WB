import { NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getEmployeesOnLeaveToday } from '@/lib/leaveSupabase/onLeaveToday';
import { getManagedEmployeeIds } from '@/lib/leaveSupabase/organization';

// Feedback item #1 — "KPI cards for HR to view employees who are on
// pre-approved leave today." HR gets the org-wide count; a manager/lead
// landing on the (read-only) Dashboard gets their own team's count —
// same scoping rule app/page.tsx already applies to teamCodes for the
// attendance data, applied here to leave data instead.
export async function GET() {
  const supabase = await createLeaveClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: employee } = await supabase
    .from('employees')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: 'No employee record linked to this account' }, { status: 403 });

  let employeeIds: string[] | undefined;
  if (employee.role === 'manager') {
    const { employeeIds: managed } = await getManagedEmployeeIds(supabase, employee.id);
    employeeIds = managed;
  } else if (employee.role === 'lead') {
    const { data: reports } = await supabase.from('employees').select('id').eq('reporting_lead_id', employee.id);
    employeeIds = (reports ?? []).map((r) => r.id);
  }
  // hr / hr_super_admin: employeeIds stays undefined -> org-wide.

  const { rows, error } = await getEmployeesOnLeaveToday(supabase, undefined, employeeIds);
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ count: rows.length, employees: rows });
}
