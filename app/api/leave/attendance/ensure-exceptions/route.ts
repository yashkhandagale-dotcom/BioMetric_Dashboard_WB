import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { ensureAttendanceExceptionRows, exceptionKey } from '@/lib/leaveSupabase/attendanceEscalation';

// Backs AbsenteesPanel.tsx / HalfDayPanel.tsx's Remind/ACK buttons —
// see ensureAttendanceExceptionRows's header comment in
// attendanceEscalation.ts for why this lazy-upsert step exists now
// that HR no longer resolves these rows directly (Part C, §C.4).
export async function POST(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await supabase.from('employees').select('id, role').eq('auth_user_id', user.id).maybeSingle();
  if (!actingEmployee || !['manager', 'lead', 'hr', 'hr_super_admin'].includes(actingEmployee.role)) {
    return NextResponse.json({ error: 'Only a manager, lead, or HR can view this' }, { status: 403 });
  }

  const body = await req.json();
  const entries = (body.entries ?? []) as {
    employeeId: string;
    date: string;
    kind: 'absent' | 'possible_half_day';
    firstPunch?: string | null;
    lastPunch?: string | null;
  }[];
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ targets: {} });
  }

  const service = createLeaveServiceClient();
  const map = await ensureAttendanceExceptionRows(service, entries);

  const targets: Record<string, { id: string; reminderCount: number }> = {};
  for (const e of entries) {
    const v = map.get(exceptionKey(e.employeeId, e.date));
    if (v) targets[exceptionKey(e.employeeId, e.date)] = v;
  }

  return NextResponse.json({ targets });
}
