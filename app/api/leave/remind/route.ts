import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getEffectiveApproverId } from '@/lib/leaveSupabase/organization';
import { sendLeaveReminder } from '@/lib/leaveSupabase/notifyLeaveEvent';

// "Send Reminder" — usable from the Pending Approvals queue (nudges the
// employee + their effective approver about a request still sitting
// pending) and from the Leave Tracker's Absentees/Half Day tabs (nudges
// the employee to file an application at all, plus their approver).
// HR-only (hr / hr_super_admin). Managers and leads approve/reject
// directly instead — reminding is an HR Admin action, not a manager one.
export async function POST(req: NextRequest) {
  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: actingEmployee } = await sessionClient
    .from('employees')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!actingEmployee) {
    return NextResponse.json({ error: 'No employee record linked to this account' }, { status: 403 });
  }
  const isHr = actingEmployee.role === 'hr' || actingEmployee.role === 'hr_super_admin';
  if (!isHr) {
    return NextResponse.json({ error: 'Only HR can send reminders' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { leave_request_id, employee_id, date } = body as {
    leave_request_id?: string;
    employee_id?: string;
    date?: string;
  };

  const service = createLeaveServiceClient();

  if (leave_request_id) {
    const { data: request } = await sessionClient
      .from('leave_requests')
      .select('employee_id, employees!leave_requests_employee_id_fkey!inner(department, reporting_lead_id)')
      .eq('id', leave_request_id)
      .maybeSingle();
    if (!request) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
    const requestEmployee = Array.isArray(request.employees) ? request.employees[0] : request.employees;
    const { approverId } = await getEffectiveApproverId(sessionClient, {
      department: requestEmployee?.department ?? null,
      reporting_lead_id: requestEmployee?.reporting_lead_id ?? null,
    });
    if (!isHr && approverId !== actingEmployee.id) {
      return NextResponse.json({ error: 'You can only send reminders for your own direct reports' }, { status: 403 });
    }
    const result = await sendLeaveReminder(service, { mode: 'pending_request', requestId: leave_request_id }, 'manual');
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (employee_id && date) {
    const { data: targetEmployee } = await sessionClient
      .from('employees')
      .select('department, reporting_lead_id')
      .eq('id', employee_id)
      .maybeSingle();
    if (!targetEmployee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    const { approverId } = await getEffectiveApproverId(sessionClient, targetEmployee);
    if (!isHr && approverId !== actingEmployee.id) {
      return NextResponse.json({ error: 'You can only send reminders for your own direct reports' }, { status: 403 });
    }
    const result = await sendLeaveReminder(service, { mode: 'missing_application', employeeId: employee_id, date }, 'manual');
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Provide either leave_request_id, or employee_id + date' }, { status: 400 });
}
