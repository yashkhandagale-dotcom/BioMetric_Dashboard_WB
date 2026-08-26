import { NextResponse } from 'next/server';
import { createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

// GET /api/leave/admin/pending-signups — HR-only. Backs the "New
// sign-ins awaiting setup" panel on /leave/admin
// (components/leave/NewJoinersPanel.tsx). See
// 0017_pending_signups_and_probation.sql and app/api/auth/callback/
// route.ts for how rows land here in the first place — always a Google
// sign-in with no matching employees row yet, never anything HR typed.
export async function GET() {
  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const service = createLeaveServiceClient();
  const { data, error } = await service
    .from('pending_employee_signups')
    .select('id, auth_user_id, email, full_name, avatar_url, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ signups: data ?? [] });
}
