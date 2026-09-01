import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { TrackerLeaveTypeCode } from '@/lib/leaveSupabase/leaveTypeMap';
import { previewLeavePolicy } from '@/lib/leaveSupabase/applyLeavePolicyAndMutateBalance';

const VALID_CODES: TrackerLeaveTypeCode[] = ['SL', 'CL', 'PL', 'LWP'];

// Dry-run companion to POST /api/leave/me/requests — same policy engine,
// same checks, but never inserts a row or touches a balance. Called by
// ApplyLeaveForm.tsx (debounced) every time leave type / dates / half-day
// changes, so the employee sees the same warnings they'd get after
// submitting — before they submit. Keeps every check in one place
// (previewLeavePolicy mirrors createAndMaybeApprove's own checks) rather
// than a second, drifting copy of the policy logic living in the client.
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

  const body = await req.json().catch(() => ({}));
  const {
    leave_type_code,
    start_date,
    end_date,
    is_half_day,
    total_days,
    day_breakdown,
  }: {
    leave_type_code?: string;
    start_date?: string;
    end_date?: string;
    is_half_day?: boolean;
    total_days?: number;
    day_breakdown?: { date: string; isHalfDay: boolean; session?: 'AM' | 'PM' }[];
  } = body;

  if (!leave_type_code || !start_date) {
    return NextResponse.json({ error: 'leave_type_code and start_date are required' }, { status: 400 });
  }
  if (!VALID_CODES.includes(leave_type_code as TrackerLeaveTypeCode)) {
    return NextResponse.json({ error: `leave_type_code must be one of ${VALID_CODES.join(', ')}` }, { status: 400 });
  }

  const result = await previewLeavePolicy({
    employeeId: me.id,
    leaveTypeCode: leave_type_code as TrackerLeaveTypeCode,
    startDate: start_date,
    endDate: end_date ?? null,
    isHalfDay: !!is_half_day,
    totalDays: total_days,
    dayBreakdown: day_breakdown,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    total_days: result.totalDays,
    notes: result.notes,
    would_be_lwp: result.wouldBeLwp,
    current_balance: result.currentBalance,
  });
}
