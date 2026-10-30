import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { applyLeavePolicyAndMutateBalance } from '@/lib/leaveSupabase/applyLeavePolicyAndMutateBalance';
import { getEffectiveApproverId, getManagedEmployeeIds } from '@/lib/leaveSupabase/organization';

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
    return NextResponse.json({ error: 'Only a manager, lead, or HR can approve leave requests' }, { status: 403 });
  }

  const { data: request } = await sessionClient
    .from('leave_requests')
    .select('id, employee_id, action_plan, employees!leave_requests_employee_id_fkey!inner(department, reporting_lead_id)')
    .eq('id', id)
    .maybeSingle();
  if (!request) {
    return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  }

  // Prevent self-approval (hard rule: no employee or manager may approve their own leave)
  if (request.employee_id === actingEmployee.id) {
    return NextResponse.json({ error: 'You cannot approve your own leave request.' }, { status: 400 });
  }
  const requestEmployee = Array.isArray(request.employees) ? request.employees[0] : request.employees;
  const { approverId, via } = await getEffectiveApproverId(sessionClient, {
    department: requestEmployee?.department ?? null,
    reporting_lead_id: requestEmployee?.reporting_lead_id ?? null,
  });

  const isEffectiveApprover = !!approverId && approverId === actingEmployee.id;
  const isHr = actingEmployee.role === 'hr' || actingEmployee.role === 'hr_super_admin';
  let isManaged = false;
  if (!isEffectiveApprover && !isHr) {
    const { employeeIds: managedIds } = await getManagedEmployeeIds(sessionClient, actingEmployee.id);
    isManaged = managedIds.includes(request.employee_id);
  }

  if (!isEffectiveApprover && !isHr && !isManaged) {
    return NextResponse.json({ error: 'You can only approve requests from employees in your management hierarchy' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    overrideLeaveTypeCode,
    overrideStartDate,
    overrideEndDate,
    overrideTotalDays,
    overrideIsHalfDay,
    overrideHalfDaySession,
    managerNote,
  } = body || {};

  // Discretionary manager override: allow updating leave type, dates, or total days prior to debit
  if (overrideLeaveTypeCode || overrideStartDate || overrideEndDate || overrideTotalDays !== undefined) {
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (overrideLeaveTypeCode) {
      const { data: lt } = await sessionClient
        .from('leave_types')
        .select('id')
        .eq('code', overrideLeaveTypeCode)
        .maybeSingle();
      if (lt) {
        updatePayload.leave_type_id = lt.id;
      }
    }
    if (overrideStartDate) updatePayload.start_date = overrideStartDate;
    if (overrideEndDate) updatePayload.end_date = overrideEndDate;
    if (overrideTotalDays !== undefined && Number(overrideTotalDays) > 0) {
      updatePayload.total_days = Number(overrideTotalDays);
    }
    if (typeof overrideIsHalfDay === 'boolean') {
      updatePayload.is_half_day = overrideIsHalfDay;
    }
    if (overrideHalfDaySession) {
      updatePayload.half_day_session = overrideHalfDaySession;
    }
    if (managerNote) {
      updatePayload.action_plan = request.action_plan
        ? `${request.action_plan}\n[Manager Override: ${managerNote}]`
        : `[Manager Override: ${managerNote}]`;
    }

    await sessionClient.from('leave_requests').update(updatePayload).eq('id', id);
  }

  const result = await applyLeavePolicyAndMutateBalance({
    employeeId: request.employee_id,
    leaveTypeCode: 'SL',
    startDate: '',
    isHalfDay: false,
    reason: '',
    source: 'manager_approval',
    existingRequestId: id,
    actingEmployeeId: actingEmployee.id,
    approvalComment: managerNote,
    approverRole: isHr && !isEffectiveApprover ? 'hr' : via === 'lead' ? 'lead' : 'manager',
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
