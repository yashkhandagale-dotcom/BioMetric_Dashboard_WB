import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { applyLeavePolicyAndMutateBalance } from '@/lib/leaveSupabase/applyLeavePolicyAndMutateBalance';

// B2 — Cancellation. "Employee or HR can cancel a pending or
// not-yet-started approved request." Manager is deliberately NOT given
// a separate cancel authorization here — the plan never lists cancel as
// a manager action (only apply/approve/reject), so this route checks
// exactly the two roles the prompt names: the request's own employee,
// or HR/HR-super-admin.
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

  const { data: request } = await sessionClient
    .from('leave_requests')
    .select('id, employee_id, status, start_date')
    .eq('id', id)
    .maybeSingle();
  if (!request) {
    return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  }

  const isOwnRequest = request.employee_id === actingEmployee.id;
  const isHr = actingEmployee.role === 'hr' || actingEmployee.role === 'hr_super_admin';
  if (!isOwnRequest && !isHr) {
    return NextResponse.json({ error: 'You can only cancel your own leave requests' }, { status: 403 });
  }

  if (request.status !== 'pending' && request.status !== 'approved' && request.status !== 'auto_lwp') {
    return NextResponse.json({ error: `Request is already '${request.status}' — nothing to cancel.` }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const alreadyStarted = request.status !== 'pending' && request.start_date <= today;
  if (alreadyStarted) {
    return NextResponse.json(
      { error: 'This leave has already started — it can no longer be cancelled.' },
      { status: 400 }
    );
  }

  const result = await applyLeavePolicyAndMutateBalance({
    employeeId: request.employee_id,
    leaveTypeCode: 'SL',
    startDate: '',
    isHalfDay: false,
    reason: '',
    source: 'cancellation',
    existingRequestId: id,
  });

  if (result.violation) {
    return NextResponse.json({ error: result.violation.reason }, { status: 400 });
  }

  return NextResponse.json({ leave_request: result.leaveRequest });
}