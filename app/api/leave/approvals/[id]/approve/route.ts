import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { applyLeavePolicyAndMutateBalance } from '@/lib/leaveSupabase/applyLeavePolicyAndMutateBalance';

// B2 — Approve. Only the request's own direct manager (or HR, who can
// override anywhere per the plan's role table) may approve it — checked
// here against reporting_manager_id rather than trusting the client,
// since this is a real balance-mutating write.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  if (!['manager', 'hr', 'hr_super_admin'].includes(actingEmployee.role)) {
    return NextResponse.json({ error: 'Only a manager or HR can approve leave requests' }, { status: 403 });
  }

  const { data: request } = await sessionClient
    .from('leave_requests')
    .select('id, employee_id, employees!inner(reporting_manager_id)')
    .eq('id', id)
    .maybeSingle();
  if (!request) {
    return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  }
  const reportingManagerId = Array.isArray(request.employees)
    ? request.employees[0]?.reporting_manager_id
    : (request.employees as unknown as { reporting_manager_id: string | null })?.reporting_manager_id;

  const isOwnManager = reportingManagerId === actingEmployee.id;
  const isHr = actingEmployee.role === 'hr' || actingEmployee.role === 'hr_super_admin';
  if (!isOwnManager && !isHr) {
    return NextResponse.json({ error: 'You can only approve requests from your own direct reports' }, { status: 403 });
  }

  const result = await applyLeavePolicyAndMutateBalance({
    // These fields are ignored by the manager_approval branch (it acts
    // on existingRequestId), but the type requires them — mirroring how
    // approveExistingRequest itself only reads existingRequestId/
    // actingEmployeeId/approverRole for this source.
    employeeId: request.employee_id,
    leaveTypeCode: 'SL',
    startDate: '',
    isHalfDay: false,
    reason: '',
    source: 'manager_approval',
    existingRequestId: id,
    actingEmployeeId: actingEmployee.id,
    approverRole: isHr && !isOwnManager ? 'hr' : 'manager',
  });

  if (result.violation) {
    return NextResponse.json({ error: result.violation.reason }, { status: 400 });
  }

  return NextResponse.json({
    leave_request: result.leaveRequest,
    converted_to_lwp: result.convertedToLwp,
    policy_notes: result.policyNotes,
  });
}