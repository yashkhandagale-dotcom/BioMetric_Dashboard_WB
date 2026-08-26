import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';

// Minimal "who am I" endpoint for client components that need to gate
// UI by role but live under a route whose page.tsx is itself a client
// component (e.g. app/leave/admin/history/page.tsx), so they can't just
// receive `role` as a server-rendered prop the way most other pages do.
// Kept intentionally tiny — id/role/full_name only, nothing this route
// needs beyond deciding what to show.
export async function GET(_req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: employee } = await supabase
    .from('employees')
    .select('id, role, full_name')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: 'Employee record not found for this account' }, { status: 403 });

  return NextResponse.json({ employee });
}
