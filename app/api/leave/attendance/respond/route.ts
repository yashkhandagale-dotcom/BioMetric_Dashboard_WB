import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { respondToAttendanceException } from '@/lib/leaveSupabase/attendanceEscalation';

// Part C, §C.2 — the employee's own response to one of their unmarked
// attendance exceptions, from /leave/me. Always requires a note.
// Three choices:
//   missed_punch — resolved immediately, no approval needed.
//   half_day     — creates a pending half-day leave_requests row
//                   (requires leave_type_code), routed to their manager.
//   regularise   — creates a pending leave_regularisations row, routed
//                   to their manager.
export async function POST(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await supabase.from('employees').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (!actingEmployee) return NextResponse.json({ error: 'Employee record not found for this account' }, { status: 403 });

  const body = await req.json();
  const { exceptionId, choice, note, leaveTypeCode } = body as {
    exceptionId?: string;
    choice?: 'missed_punch' | 'half_day' | 'regularise';
    note?: string;
    leaveTypeCode?: 'SL' | 'CL' | 'PL';
  };

  if (!exceptionId || !choice || !note) {
    return NextResponse.json({ error: 'exceptionId, choice, and note are required' }, { status: 400 });
  }
  if (!['missed_punch', 'half_day', 'regularise'].includes(choice)) {
    return NextResponse.json({ error: 'choice must be one of missed_punch, half_day, regularise' }, { status: 400 });
  }

  const service = createLeaveServiceClient();
  const result = await respondToAttendanceException(service, {
    exceptionId,
    employeeId: actingEmployee.id,
    choice,
    note,
    leaveTypeCode,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({
    ok: true,
    leaveRequestId: result.leaveRequestId ?? null,
    regularisationId: result.regularisationId ?? null,
  });
}
