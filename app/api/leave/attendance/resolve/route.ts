import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';

// Records HR's action on a Today's Absentees / Possible Half Day row so it
// stops reappearing once handled.
//
// Two actions land here:
//   - 'ignore' — a false positive (punch-machine glitch etc). No leave/
//     attendance side effect.
//   - 'leave_recorded' — HR has just recorded an actual leave for this
//     employee/day (via RecordLeaveForm — see RecordLeaveDrawer, wired up
//     from AbsenteesPanel/HalfDayPanel's "Record Leave" button and
//     CalendarDayDrawer's "Record leave" button). This is what replaces
//     the old "ACK -> auto-convert to LWP" flow: instead of HR
//     force-converting an unresolved day to Leave Without Pay after 3
//     reminders, HR records whatever the actual leave was and this marks
//     the day resolved, attributed to HR. `resolution` lands on
//     'leave_recorded' (already a valid value on the check constraint
//     since migration 0015 — this route just never accepted it before;
//     CalendarDayDrawer.tsx was already calling this route with this
//     exact action/shape, so before this change every "Record leave"
//     click from the calendar silently failed at this last step — the
//     leave itself got recorded, but the day never left the
//     unresolved/unrecorded list).
export async function POST(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json();
  const { employee_id, date, action, note, first_punch, last_punch, leave_request_id } = body as {
    employee_id?: string;
    date?: string;
    action?: 'ignore' | 'leave_recorded';
    note?: string;
    first_punch?: string | null;
    last_punch?: string | null;
    leave_request_id?: string;
  };

  if (!employee_id || !date || !action) {
    return NextResponse.json({ error: 'employee_id, date and action are required' }, { status: 400 });
  }
  if (action !== 'ignore' && action !== 'leave_recorded') {
    return NextResponse.json(
      {
        error:
          "Only 'ignore' and 'leave_recorded' are available here — half-day and missed-punch resolutions are made by the employee themselves via My Leave.",
      },
      { status: 400 }
    );
  }
  if (action === 'leave_recorded' && !leave_request_id) {
    return NextResponse.json(
      { error: 'leave_request_id is required to mark this day as leave recorded.' },
      { status: 400 }
    );
  }

  const service = createLeaveServiceClient();

  // Resolve the acting employee id (attendance_exceptions.resolved_by
  // references employees.id, not auth.users.id) — mirrors how other
  // routes in this app resolve "who is doing this" from the session.
  const { data: actingEmployee } = await supabase
    .from('employees')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  // Recording leave against someone else's day is an HR action (the
  // underlying leave already went through POST /api/leave/employees/
  // requests, which itself only lets plain `hr` — not hr_super_admin —
  // record leave on someone's behalf). This is a defense-in-depth check
  // for the follow-up "mark it resolved" step, not the primary gate.
  if (action === 'leave_recorded' && (!actingEmployee || !['hr', 'hr_super_admin'].includes(actingEmployee.role))) {
    return NextResponse.json({ error: 'Only HR can record a leave against this day.' }, { status: 403 });
  }

  const patch: Record<string, unknown> = {
    employee_id,
    exception_date: date,
    exception_type: 'absent',
    first_punch: first_punch ?? null,
    last_punch: last_punch ?? null,
    resolution: action === 'leave_recorded' ? 'leave_recorded' : 'ignored',
    resolution_note: note ?? null,
    resolved_by: actingEmployee?.id ?? null,
    resolved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (action === 'leave_recorded') patch.leave_request_id = leave_request_id;

  const { data: exception, error: exceptionError } = await service
    .from('attendance_exceptions')
    .upsert(patch, { onConflict: 'employee_id,exception_date' })
    .select('id, resolution')
    .single();

  if (exceptionError) {
    return NextResponse.json({ error: exceptionError.message }, { status: 400 });
  }

  return NextResponse.json({ exception });
}