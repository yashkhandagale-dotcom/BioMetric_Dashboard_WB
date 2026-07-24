import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';

// Records HR's action on a Today's Absentees / Possible Half Day row so it
// stops reappearing once handled. Three actions:
//
//   - "ignore": no side effect beyond marking this employee+date reviewed.
//     Use for false positives (e.g. a punch machine glitch already known
//     about) — explicitly does not create leave or an attendance record.
//
//   - "missed_punch": inserts into `missed_punch` (NOT leave — no
//     leave_request, no leave_balances/balance_transactions write at all)
//     and links it from attendance_exceptions for the audit trail.
//
//   - "half_day": does NOT create the leave here — the actual leave
//     (Half Casual/Sick/Paid Leave) is recorded through the existing,
//     unmodified Record Leave flow (RecordLeaveForm → POST
//     /api/leave/employees/requests with is_half_day=true). This endpoint
//     is called *after* that succeeds, passing the resulting
//     leave_request_id, purely to mark the exception resolved and avoid
//     re-showing the same employee+date once real leave exists for it.
export async function POST(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json();
  const {
    employee_id,
    date,
    action,
    note,
    first_punch,
    last_punch,
    leave_request_id,
  } = body as {
    employee_id?: string;
    date?: string;
    action?: 'ignore' | 'missed_punch' | 'half_day' | 'leave_recorded';
    note?: string;
    first_punch?: string | null;
    last_punch?: string | null;
    leave_request_id?: string;
  };

  if (!employee_id || !date || !action) {
    return NextResponse.json({ error: 'employee_id, date and action are required' }, { status: 400 });
  }
  if ((action === 'half_day' || action === 'leave_recorded') && !leave_request_id) {
    return NextResponse.json(
      { error: 'leave_request_id is required for this resolution — record the leave first.' },
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

  let missedPunchId: string | null = null;
  if (action === 'missed_punch') {
    const { data: mp, error: mpError } = await service
      .from('missed_punch')
      .upsert(
        {
          employee_id,
          punch_date: date,
          first_punch: first_punch ?? null,
          last_punch: last_punch ?? null,
          note: note ?? null,
          recorded_by: actingEmployee?.id ?? null,
        },
        { onConflict: 'employee_id,punch_date' }
      )
      .select('id')
      .single();
    if (mpError) {
      return NextResponse.json({ error: mpError.message }, { status: 400 });
    }
    missedPunchId = mp.id;
  }

  const resolution =
    action === 'missed_punch' ? 'missed_punch' : action === 'half_day' || action === 'leave_recorded' ? action : 'ignored';

  const { data: exception, error: exceptionError } = await service
    .from('attendance_exceptions')
    .upsert(
      {
        employee_id,
        exception_date: date,
        exception_type:
          action === 'missed_punch' ? 'missed_punch_detected' : action === 'half_day' ? 'possible_half_day' : 'absent',
        first_punch: first_punch ?? null,
        last_punch: last_punch ?? null,
        resolution,
        resolution_note: note ?? null,
        leave_request_id: action === 'half_day' || action === 'leave_recorded' ? leave_request_id : null,
        missed_punch_id: missedPunchId,
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