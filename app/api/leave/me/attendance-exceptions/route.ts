import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getMyUnmarkedAttendanceExceptions } from '@/lib/leaveSupabase/attendanceEscalation';

// Part C, §C.2 — the employee's own unmarked attendance days, for the
// review cards on /leave/me.
export async function GET(_req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await supabase.from('employees').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (!actingEmployee) return NextResponse.json({ error: 'Employee record not found for this account' }, { status: 403 });

  const service = createLeaveServiceClient();
  const { exceptions, error } = await getMyUnmarkedAttendanceExceptions(service, actingEmployee.id);
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ exceptions });
}
