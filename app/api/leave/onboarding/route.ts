import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';

// POST /api/leave/onboarding — completes the first-login confirmation
// screen (app/leave/onboarding). Any authenticated employee can call
// this for THEIR OWN row only (scoped by auth_user_id, not an :id param
// — there is nothing here for HR to do on someone else's behalf).
//
// Only touches fields that are genuinely employee-editable (section 5 of
// the task: "allow editing only for fields that are intended to be
// employee-editable"). Everything HR-controlled — role, employee_code,
// date_of_joining, employment_status, reporting_lead_id/
// reporting_manager_id, department, office — is deliberately absent from
// this handler entirely, same as the existing profile PATCH route
// (app/api/leave/employees/[id]/profile/route.ts) already keeps those
// HR-only.
export async function POST(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const phone = typeof body?.phone === 'string' ? body.phone.trim().slice(0, 40) : undefined;

  const update: Record<string, unknown> = {
    profile_confirmed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (phone !== undefined) update.phone = phone || null;

  const { data, error } = await supabase
    .from('employees')
    .update(update)
    .eq('auth_user_id', user.id)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: 'No employee record is linked to this account.' }, { status: 404 });
  }

  return NextResponse.json({ message: 'Profile confirmed.' });
}
