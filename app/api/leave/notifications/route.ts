import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';

// notifyLeaveEvent.ts / sendLeaveReminder have been writing rows into
// `notifications` since the leave tracker overhaul (see that file's
// header comment) — for every approve/reject/cancel AND for every HR
// "Send Reminder" click. Nothing in the app ever read them back out for
// a signed-in employee/manager, which is why reminders looked like
// they were silently vanishing: they were being recorded, just never
// displayed anywhere. This route (+ NotificationBell.tsx) is the read
// side of that same table — no changes to how/when rows get written.
export async function GET(_req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await supabase.from('employees').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (!actingEmployee) return NextResponse.json({ error: 'Employee record not found for this account' }, { status: 403 });

  const service = createLeaveServiceClient();
  const { data, error } = await service
    .from('notifications')
    .select('id, type, title, body, is_read, created_at, leave_request_id')
    .eq('recipient_employee_id', actingEmployee.id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const unreadCount = (data ?? []).filter((n) => !n.is_read).length;
  return NextResponse.json({ notifications: data ?? [], unreadCount });
}

// Marks one notification (or, with `all: true`, every unread notification
// for this employee) as read. Called when the bell dropdown opens
// (mark-all) and isn't otherwise exposed per-row — there's nothing else
// to do with an individual notification once it's been seen.
export async function PATCH(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: actingEmployee } = await supabase.from('employees').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (!actingEmployee) return NextResponse.json({ error: 'Employee record not found for this account' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { id, all } = body as { id?: string; all?: boolean };

  const service = createLeaveServiceClient();
  let query = service.from('notifications').update({ is_read: true }).eq('recipient_employee_id', actingEmployee.id);
  query = all ? query.eq('is_read', false) : query.eq('id', id ?? '00000000-0000-0000-0000-000000000000');

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
