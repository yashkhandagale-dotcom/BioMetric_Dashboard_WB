import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { TrackerLeaveTypeCode } from '@/lib/leaveSupabase/leaveTypeMap';
import { applyLeavePolicyAndMutateBalance } from '@/lib/leaveSupabase/applyLeavePolicyAndMutateBalance';

const VALID_CODES: TrackerLeaveTypeCode[] = ['SL', 'CL', 'PL', 'LWP'];

// A5 — the employee self-service "Apply for Leave" route. Mirrors
// app/api/leave/employees/requests/route.ts's request-shape validation
// exactly (same field set, same error messages) but calls
// applyLeavePolicyAndMutateBalance with source: 'self_apply' instead of
// 'hr_manual', and — critically — the caller is always the signed-in
// employee themselves (resolved from the session, never taken from the
// request body), so nobody can self-apply on someone else's behalf
// through this endpoint. hr_manual's HR-only bulk-entry route is
// untouched.
//
// Per A5: violations are never submit-blocking here either — the same
// `result.violation` shape only appears for genuine hard failures
// (employee/leave-type not found, bad date range, insert failure); a
// policy *warning* (notice-shortfall, SL certificate note, auto-LWP
// conversion) always comes back as a 201 with `policy_notes` populated,
// exactly like the HR route already does. The client renders that as a
// non-blocking banner (see ApplyLeaveForm.tsx).
export async function POST(req: NextRequest) {
  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: me } = await sessionClient
    .from('employees')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: 'No employee record linked to this account' }, { status: 403 });
  }

  const body = await req.json();
  const {
    leave_type_code,
    start_date,
    end_date,
    is_half_day,
    half_day_session,
    total_days,
    day_breakdown,
    reason,
    action_plan,
  }: {
    leave_type_code?: string;
    start_date?: string;
    end_date?: string;
    is_half_day?: boolean;
    half_day_session?: 'AM' | 'PM';
    total_days?: number;
    day_breakdown?: { date: string; isHalfDay: boolean; session?: 'AM' | 'PM' }[];
    reason?: string;
    action_plan?: string;
  } = body;

  if (!leave_type_code || !start_date || !reason) {
    return NextResponse.json(
      { error: 'Missing required fields: leave_type_code, start_date, reason' },
      { status: 400 }
    );
  }
  if (!VALID_CODES.includes(leave_type_code as TrackerLeaveTypeCode)) {
    return NextResponse.json({ error: `leave_type_code must be one of ${VALID_CODES.join(', ')}` }, { status: 400 });
  }
  if (is_half_day && total_days === 0.5 && half_day_session !== 'AM' && half_day_session !== 'PM') {
    return NextResponse.json({ error: 'half_day_session (AM or PM) is required when is_half_day is true' }, { status: 400 });
  }
  if (leave_type_code === 'PL' && !action_plan?.trim()) {
    return NextResponse.json({ error: 'An action plan is required for Planned leave.' }, { status: 400 });
  }

  const result = await applyLeavePolicyAndMutateBalance({
    employeeId: me.id,
    leaveTypeCode: leave_type_code as TrackerLeaveTypeCode,
    startDate: start_date,
    endDate: end_date ?? null,
    isHalfDay: !!is_half_day,
    halfDaySession: is_half_day ? half_day_session : undefined,
    totalDays: total_days,
    dayBreakdown: day_breakdown,
    reason,
    actionPlan: action_plan,
    source: 'self_apply',
    actingEmployeeId: me.id,
  });

  if (result.violation) {
    if (result.violation.type === 'debit_failed') {
      return NextResponse.json(
        { error: result.violation.reason, policy_notes: result.policyNotes },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: result.violation.reason }, { status: 400 });
  }

  return NextResponse.json(
    {
      leave_request: result.leaveRequest,
      converted_to_lwp: result.convertedToLwp,
      policy_notes: result.policyNotes,
    },
    { status: 201 }
  );
}