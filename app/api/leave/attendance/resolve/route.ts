import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';

// Records HR's action on a Today's Absentees / Possible Half Day row so it
// stops reappearing once handled.
//
// Part C (MASTER_PLAN_CONSOLIDATED.md §C.4) removed HR's direct-
// resolution powers here — half_day/missed_punch/leave_recorded are now
// exclusively the EMPLOYEE's own call, made via
// POST /api/leave/attendance/respond from /leave/me. HR's remaining
// actions on this queue are: "ignore" (false positives — a punch
// machine glitch already known about; explicitly no leave/attendance
// side effect) below, plus "remind" and "ack" via their own dedicated
// routes (/api/leave/attendance/remind, /api/leave/attendance/ack).
export async function POST(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json();
  const { employee_id, date, action, note, first_punch, last_punch } = body as {
    employee_id?: string;
    date?: string;
    action?: 'ignore';
    note?: string;
    first_punch?: string | null;
    last_punch?: string | null;
  };

  if (!employee_id || !date || !action) {
    return NextResponse.json({ error: 'employee_id, date and action are required' }, { status: 400 });
  }
  if (action !== 'ignore') {
    return NextResponse.json(
      {
        error:
          "Only 'ignore' is available here — half-day, missed-punch, and leave resolutions are now made by the employee themselves via My Leave.",
      },
      { status: 400 }
    );
  }

  const service = createLeaveServiceClient();

  // Resolve the acting employee id (attendance_exceptions.resolved_by
  // references employees.id, not auth.users.id) — mirrors how other
  // routes in this app resolve "who is doing this" from the session.
  const { data: actingEmployee } = await supabase
    .from('employees')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  const { data: exception, error: exceptionError } = await service
    .from('attendance_exceptions')
    .upsert(
      {
        employee_id,
        exception_date: date,
        exception_type: 'absent',
        first_punch: first_punch ?? null,
        last_punch: last_punch ?? null,
        resolution: 'ignored',
        resolution_note: note ?? null,
        resolved_by: actingEmployee?.id ?? null,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'employee_id,exception_date' }
    )
    .select('id, resolution')
    .single();

  if (exceptionError) {
    return NextResponse.json({ error: exceptionError.message }, { status: 400 });
  }

  return NextResponse.json({ exception });
}