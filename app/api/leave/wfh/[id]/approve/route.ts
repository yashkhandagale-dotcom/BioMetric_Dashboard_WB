import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { approveWfhRequest } from '@/lib/leaveSupabase/wfhRequests';
import { getEffectiveApproverId } from '@/lib/leaveSupabase/organization';

// Feedback item #6 — WFH approval, restricted to the employee's
// effective approver (department's manager — the "Delivery Manager" for
// Delivery-department employees, same routing leave already uses) or
// HR. Same authorization shape as app/api/leave/approvals/[id]/approve.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await sessionClient
    .from('employees')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!actingEmployee) return NextResponse.json({ error: 'No employee record linked to this account' }, { status: 403 });
  if (!['manager', 'lead', 'hr', 'hr_super_admin'].includes(actingEmployee.role)) {
    return NextResponse.json({ error: 'Only a manager, lead, or HR can approve WFH requests' }, { status: 403 });
  }

  const { data: request } = await sessionClient
    .from('wfh_requests')
    .select('id, employee_id, employees!inner(department, reporting_lead_id)')
    .eq('id', id)
    .maybeSingle();
  if (!request) return NextResponse.json({ error: 'WFH request not found' }, { status: 404 });

  const requestEmployee = Array.isArray(request.employees) ? request.employees[0] : request.employees;
  const { approverId } = await getEffectiveApproverId(sessionClient, {
    department: requestEmployee?.department ?? null,
    reporting_lead_id: requestEmployee?.reporting_lead_id ?? null,
  });

  const isEffectiveApprover = !!approverId && approverId === actingEmployee.id;
  const isHr = actingEmployee.role === 'hr' || actingEmployee.role === 'hr_super_admin';
  if (!isEffectiveApprover && !isHr) {
    return NextResponse.json({ error: 'You can only approve WFH requests from your own direct reports' }, { status: 403 });
  }
  if (isHr && !isEffectiveApprover) {
    // hr_super_admin is remind-only elsewhere in this app — mirror that
    // restriction here for consistency (only plain 'hr' or the actual
    // effective approver can approve).
    if (actingEmployee.role === 'hr_super_admin') {
      return NextResponse.json({ error: 'HR Admin is remind-only — cannot approve/reject directly' }, { status: 403 });
    }
  }

  const result = await approveWfhRequest(sessionClient, id, actingEmployee.id);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ id: result.id });
}
