import { NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';

// Backs the Info modal (HR/Admin only — gated by the same
// LeaveAdminLayout auth check every /leave/admin/** route already has,
// so no separate role check needed here per that layout's "v1 scope"
// comment). Returns the real leave_types rows so the modal's quota/
// notice/certificate numbers can never drift from what
// /api/leave/employees/requests actually enforces — no numbers are
// duplicated by hand here.
export async function GET() {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: leaveTypes, error } = await supabase
    .from('leave_types')
    .select('code, display_name, annual_quota, max_consecutive_days, min_notice_days_tier, requires_certificate_after_days, is_directly_applicable')
    .order('code');

  if (error) {
    return NextResponse.json({ error: error.message, leaveTypes: [] }, { status: 400 });
  }

  return NextResponse.json({ leaveTypes: leaveTypes ?? [] });
}