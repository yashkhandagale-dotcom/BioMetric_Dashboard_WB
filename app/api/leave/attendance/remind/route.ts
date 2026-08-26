import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { sendEscalationReminder, type EscalationTargetType } from '@/lib/leaveSupabase/attendanceEscalation';

// Part C, §C.5 — the manual "Remind now" half of the hybrid reminder
// delivery (the other half is the daily cron sweep — see
// runEscalationSweep, wired into app/api/leave/admin/jobs). Same
// function either way, so the counter never disagrees between the two
// paths. HR/manager/lead only — an employee reminding themselves, or
// reminding their own manager, isn't a thing this button does.
export async function POST(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await supabase.from('employees').select('id, role').eq('auth_user_id', user.id).maybeSingle();
  if (!actingEmployee || !['manager', 'lead', 'hr', 'hr_super_admin'].includes(actingEmployee.role)) {
    return NextResponse.json({ error: 'Only a manager, lead, or HR can send a reminder' }, { status: 403 });
  }

  const body = await req.json();
  const { targetType, targetId } = body as { targetType?: EscalationTargetType; targetId?: string };
  if (!targetType || !targetId) {
    return NextResponse.json({ error: 'targetType and targetId are required' }, { status: 400 });
  }
  if (!['attendance_exception_unmarked', 'leave_request_pending', 'regularisation_pending'].includes(targetType)) {
    return NextResponse.json({ error: 'Invalid targetType' }, { status: 400 });
  }

  const service = createLeaveServiceClient();
  const result = await sendEscalationReminder(service, targetType, targetId, 'manual');
  if (!result.ok) {
    return NextResponse.json({ error: result.error, reminderCount: result.reminderCount, nextAllowedAt: result.nextAllowedAt }, { status: 400 });
  }

  return NextResponse.json({ ok: true, reminderCount: result.reminderCount, isFinalReminder: result.isFinalReminder });
}
