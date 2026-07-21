import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear } from '@/lib/leaveSupabase/fyHelpers';

const ADJUSTABLE_CODES = ['SL', 'CL', 'PL'] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json();
  const {
    leave_type_code,
    delta,
    reason,
  }: { leave_type_code?: string; delta?: number; reason?: string } = body;

  if (!leave_type_code || !ADJUSTABLE_CODES.includes(leave_type_code as (typeof ADJUSTABLE_CODES)[number])) {
    return NextResponse.json({ error: `leave_type_code must be one of ${ADJUSTABLE_CODES.join(', ')}` }, { status: 400 });
  }
  if (typeof delta !== 'number' || delta === 0 || Number.isNaN(delta)) {
    return NextResponse.json({ error: 'delta must be a non-zero number' }, { status: 400 });
  }
  if (!reason || !reason.trim()) {
    return NextResponse.json({ error: 'A reason is required for a manual balance adjustment' }, { status: 400 });
  }

  const service = createLeaveServiceClient();

  // Resolve the signed-in auth user to an employees row for the audit
  // trail's created_by — same "may legitimately be missing" caveat as
  // the hr_manual leave-recording path (see requests/route.ts).
  const { data: hrEmployee } = await service
    .from('employees')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  const { error } = await service.rpc('fn_adjust_balance_manual', {
    p_employee_id: id,
    p_leave_type_code: leave_type_code,
    p_fy_start_year: getFYStartYear(),
    p_delta: delta,
    p_reason: reason,
    p_created_by: hrEmployee?.id ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
