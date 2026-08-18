import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { applyLeavePolicyAndMutateBalance } from '@/lib/leaveSupabase/applyLeavePolicyAndMutateBalance';
import { getEffectiveApproverId } from '@/lib/leaveSupabase/organization';

// B2 — Reject. Same effective-approver / HR-override authorization as
// approve (see getEffectiveApproverId and approve/route.ts's header
// comment for why this no longer checks reporting_manager_id directly).
// Requires a comment (enforced both here and inside
// rejectExistingRequest — see that function's own note on why it's
// re-checked at the write boundary).
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
  if (!['manager', 'lead', 'hr', 'hr_super_admin'].includes(actingEmployee.role)) {
    return NextResponse.json({ error: 'Only a manager, lead, or HR can reject leave requests' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const comment: string | undefined = body?.comment;
  if (!comment || !comment.trim()) {
    return NextResponse.json({ error: 'A comment is required to reject a leave request' }, { status: 400 });
  }

  const { data: request } = await sessionClient
    .from('leave_requests')
    .select('id, employee_id, employees!leave_requests_employee_id_fkey!inner(department, reporting_lead_id)')
    .eq('id', id)
    .maybeSingle();
  if (!request) {
    return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  }
  const requestEmployee = Array.isArray(request.employees) ? request.employees[0] : request.employees;
  const { approverId } = await getEffectiveApproverId(sessionClient, {
    department: requestEmployee?.department ?? null,
    reporting_lead_id: requestEmployee?.reporting_lead_id ?? null,
  });

  const isEffectiveApprover = !!approverId && approverId === actingEmployee.id;
  const isHr = actingEmployee.role === 'hr' || actingEmployee.role === 'hr_super_admin';
  if (!isEffectiveApprover && !isHr) {
    return NextResponse.json({ error: 'You can only reject requests from your own direct reports' }, { status: 403 });
  }

  const result = await applyLeavePolicyAndMutateBalance({
    employeeId: request.employee_id,
    leaveTypeCode: 'SL',
    startDate: '',
    isHalfDay: false,
    reason: '',
    source: 'manager_reject',
    existingRequestId: id,
    actingEmployeeId: actingEmployee.id,
    rejectionComment: comment,
  });

  if (result.violation) {
    return NextResponse.json({ error: result.violation.reason }, { status: 400 });
  }

  return NextResponse.json({ leave_request: result.leaveRequest });
}