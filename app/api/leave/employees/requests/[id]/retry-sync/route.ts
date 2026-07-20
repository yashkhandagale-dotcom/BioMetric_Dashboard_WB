import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { syncLeaveRequestToMainDashboard } from '@/lib/leaveSync';
import { TrackerLeaveTypeCode } from '@/lib/leaveSupabase/leaveTypeMap';

// Re-attempts the write-through sync for a leave_requests row whose
// initial sync (in POST /api/leave/requests) failed. Deliberately
// idempotent: syncLeaveRequestToMainDashboard() upserts on
// (employee_code, date), so retrying a partially-succeeded sync is safe.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const service = createLeaveServiceClient();

  const { data: leaveRequest, error } = await service
    .from('leave_requests')
    .select('id, start_date, end_date, is_half_day, reason, employee_id, leave_type_id, employees(employee_code, office), leave_types(code)')
    .eq('id', id)
    .single();

  if (error || !leaveRequest) {
    return NextResponse.json({ error: error?.message ?? 'Leave request not found' }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const employee = (leaveRequest as any).employees;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leaveType = (leaveRequest as any).leave_types;
  if (!employee || !leaveType) {
    return NextResponse.json({ error: 'Leave request is missing its employee or leave type link' }, { status: 400 });
  }

  const syncResult = await syncLeaveRequestToMainDashboard({
    employeeCode: employee.employee_code,
    officeCode: employee.office,
    leaveTypeCode: leaveType.code as TrackerLeaveTypeCode,
    startDate: leaveRequest.start_date,
    endDate: leaveRequest.end_date,
    isHalfDay: !!leaveRequest.is_half_day,
    markedBy: user.email ?? undefined,
    note: leaveRequest.reason,
  });

  await service
    .from('leave_requests')
    .update({
      sync_status: syncResult.synced ? 'synced' : 'failed',
      sync_error: syncResult.synced ? null : syncResult.error,
    })
    .eq('id', id);

  return NextResponse.json({ sync: syncResult }, { status: syncResult.synced ? 200 : 502 });
}