import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { ackEscalationToLwp, type EscalationTargetType } from '@/lib/leaveSupabase/attendanceEscalation';

// Part C, §C.4 — HR's ACK action. The only way HR ever finalizes an
// outcome directly, and it always results in LWP; HR can never approve
// a half-day or regularisation on someone else's behalf. Gated (inside
// ackEscalationToLwp) on reminder_count >= 3 for the target. HR only —
// managers/leads can remind, but only HR can ACK.
export async function POST(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await supabase.from('employees').select('id, role').eq('auth_user_id', user.id).maybeSingle();
  if (!actingEmployee || !['hr', 'hr_super_admin'].includes(actingEmployee.role)) {
    return NextResponse.json({ error: 'Only HR can acknowledge and convert to LWP' }, { status: 403 });
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
  const result = await ackEscalationToLwp(service, targetType, targetId, actingEmployee.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, leaveRequestId: result.leaveRequestId });
}
