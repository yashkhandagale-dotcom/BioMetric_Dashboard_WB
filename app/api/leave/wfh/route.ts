import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { applyForWfh } from '@/lib/leaveSupabase/wfhRequests';
import { getManagedEmployeeIds } from '@/lib/leaveSupabase/organization';

// Feedback items #5/#6 — WFH application. Any employee (including
// manager/lead/hr — everyone has their own leave/WFH) can apply for
// themselves.
export async function POST(req: NextRequest) {
  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await sessionClient
    .from('employees')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!actingEmployee) return NextResponse.json({ error: 'No employee record linked to this account' }, { status: 403 });

  const body = await req.json();
  const { startDate, endDate, isHalfDay, halfDaySession, reason } = body as {
    startDate?: string; endDate?: string | null; isHalfDay?: boolean; halfDaySession?: 'AM' | 'PM'; reason?: string;
  };
  if (!startDate || !reason) {
    return NextResponse.json({ error: 'startDate and reason are required' }, { status: 400 });
  }

  const { id, error } = await applyForWfh(sessionClient, {
    employeeId: actingEmployee.id,
    startDate,
    endDate,
    isHalfDay: !!isHalfDay,
    halfDaySession,
    reason,
  });
  if (error) return NextResponse.json({ error }, { status: 400 });

  return NextResponse.json({ id });
}

// GET — 'mine' (default) for the employee's own WFH history, or
// 'team=1' for a manager/lead/HR's pending+recent team WFH requests
// (used by the Approvals page alongside leave requests).
export async function GET(req: NextRequest) {
  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await sessionClient
    .from('employees')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!actingEmployee) return NextResponse.json({ error: 'No employee record linked to this account' }, { status: 403 });

  const scope = req.nextUrl.searchParams.get('scope') ?? 'mine';

  let query = sessionClient
    .from('wfh_requests')
    .select(
      `id, employee_id, start_date, end_date, is_half_day, half_day_session, reason, status,
       rejection_comment, applied_on,
       employees ( full_name, employee_code, department )`
    )
    .order('applied_on', { ascending: false });

  if (scope === 'mine') {
    query = query.eq('employee_id', actingEmployee.id);
  } else {
    const isHr = actingEmployee.role === 'hr' || actingEmployee.role === 'hr_super_admin';
    if (isHr) {
      // no additional filter — org-wide, mirrors the leave approvals queue
    } else if (actingEmployee.role === 'manager') {
      const { employeeIds } = await getManagedEmployeeIds(sessionClient, actingEmployee.id);
      query = employeeIds.length > 0
        ? query.in('employee_id', employeeIds)
        : query.eq('employee_id', '00000000-0000-0000-0000-000000000000');
    } else if (actingEmployee.role === 'lead') {
      query = query.eq('employees.reporting_lead_id', actingEmployee.id);
    } else {
      query = query.eq('employee_id', actingEmployee.id);
    }
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ requests: data ?? [] });
}
