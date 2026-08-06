import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getEmployeeAttendanceKPIs } from '@/lib/leaveSupabase/getEmployeeAttendanceKPIs';
import { monthBounds } from '@/lib/leaveCalendar';

// Backs PersonalAttendanceReport.tsx's month selector. Always scoped to
// the signed-in employee themselves — month_key is the only input taken
// from the client, employee_id is resolved from the session, exactly
// like /api/leave/me/requests.
export async function GET(req: NextRequest) {
  const supabase = await createLeaveClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('employees')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: 'No employee record linked to this account' }, { status: 403 });
  }

  const monthKey = req.nextUrl.searchParams.get('month') ?? undefined;
  const { start, end } = monthBounds(monthKey ?? new Date().toISOString().slice(0, 7));

  const { kpis, recordCount, error } = await getEmployeeAttendanceKPIs(supabase, me.id, start, end);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ kpis, recordCount, start, end });
}