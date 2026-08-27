import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { createRegularisation, listRegularisationsForEmployees } from '@/lib/leaveSupabase/regularisation';
import { getManagedEmployeeIds } from '@/lib/leaveSupabase/organization';

// Feedback item #2 — Leave Regularisation. A manager (or HR) marks a
// specific day for one of their reports as regularised, with a note.
export async function POST(req: NextRequest) {
  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await sessionClient
    .from('employees')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!actingEmployee || !['manager', 'lead', 'hr', 'hr_super_admin'].includes(actingEmployee.role)) {
    return NextResponse.json({ error: 'Only a manager, lead, or HR can regularise a day' }, { status: 403 });
  }

  const body = await req.json();
  const { employeeId, employeeIds, date, reason } = body as {
    employeeId?: string;
    employeeIds?: string[];
    date?: string;
    reason?: string;
  };

  const targetIds = (employeeIds && employeeIds.length > 0)
    ? employeeIds
    : (employeeId ? [employeeId] : []);

  if (targetIds.length === 0 || !date || !reason) {
    return NextResponse.json({ error: 'Target employee(s), date, and reason are required' }, { status: 400 });
  }

  // Scope check: a manager/lead can only regularise their own team's
  // days — HR can regularise anyone.
  const isHr = actingEmployee.role === 'hr' || actingEmployee.role === 'hr_super_admin';
  if (!isHr) {
    let allowedIds: string[] = [];
    if (actingEmployee.role === 'manager') {
      const { employeeIds: managed } = await getManagedEmployeeIds(sessionClient, actingEmployee.id);
      allowedIds = managed;
    } else {
      const { data: reports } = await sessionClient.from('employees').select('id').eq('reporting_lead_id', actingEmployee.id);
      allowedIds = (reports ?? []).map((r) => r.id);
    }
    const unauthorized = targetIds.filter((id) => !allowedIds.includes(id));
    if (unauthorized.length > 0) {
      return NextResponse.json({ error: 'You can only regularise days for your own team members' }, { status: 403 });
    }
  }

  const createdIds: string[] = [];
  for (const empId of targetIds) {
    const { id, error } = await createRegularisation(sessionClient, {
      employeeId: empId,
      date,
      reason,
      regularisedBy: actingEmployee.id,
    });
    if (error) {
      return NextResponse.json({ error: `Failed for employee ${empId}: ${error}` }, { status: 400 });
    }
    if (id) createdIds.push(id);
  }

  return NextResponse.json({ ok: true, count: createdIds.length, ids: createdIds });
}

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

  const isHr = actingEmployee.role === 'hr' || actingEmployee.role === 'hr_super_admin';
  let employeeIds: string[] = [];

  if (isHr) {
    const { data: allEmployees } = await sessionClient.from('employees').select('id');
    employeeIds = (allEmployees ?? []).map((e) => e.id);
  } else if (actingEmployee.role === 'manager') {
    const { employeeIds: managed } = await getManagedEmployeeIds(sessionClient, actingEmployee.id);
    employeeIds = managed;
  } else if (actingEmployee.role === 'lead') {
    const { data: reports } = await sessionClient.from('employees').select('id').eq('reporting_lead_id', actingEmployee.id);
    employeeIds = (reports ?? []).map((r) => r.id);
  } else {
    employeeIds = [actingEmployee.id];
  }

  const { rows, error } = await listRegularisationsForEmployees(sessionClient, employeeIds);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ regularisations: rows });
}
