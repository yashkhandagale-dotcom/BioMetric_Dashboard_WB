import { NextRequest, NextResponse } from 'next/server';
import { createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

// Sprint A — the missing piece that makes the role split actually usable.
//
// `employees.auth_user_id` has existed since the original schema but was
// never populated: every account created so far was a shared HR login
// made directly in the Supabase dashboard, with no employees row behind
// it at all. Real per-person accounts need something to create the
// auth.users row AND point employees.auth_user_id at it, atomically
// enough that we don't end up with one but not the other.
//
// POST /api/leave/admin/employees/:id/invite
//   - HR-only (checked via getCurrentEmployee, not the old "any session").
//   - If the employee already has an auth_user_id, this is a no-op that
//     reports back the existing linkage rather than silently re-inviting
//     (re-inviting would issue a new Supabase invite link for an account
//     that may already have a password set, which is confusing, not
//     idempotent).
//   - Uses supabase.auth.admin.inviteUserByEmail, which both creates the
//     auth.users row and emails a set-password link — no separate email
//     step needed here.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const service = createLeaveServiceClient();

  const { data: employee, error: fetchError } = await service
    .from('employees')
    .select('id, email, full_name, auth_user_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  }
  if (employee.auth_user_id) {
    return NextResponse.json(
      { message: 'Already linked to an auth account', auth_user_id: employee.auth_user_id },
      { status: 200 }
    );
  }

  const redirectTo = req.nextUrl.origin + '/leave/login';
  const { data: invite, error: inviteError } = await service.auth.admin.inviteUserByEmail(
    employee.email,
    { redirectTo }
  );

  if (inviteError) {
    // Most common real-world case: an auth.users row already exists for
    // this email (e.g. from an earlier manual Supabase-dashboard account)
    // but was never linked. Surface that distinctly so HR knows to link
    // rather than retry the invite.
    return NextResponse.json(
      { error: `Invite failed: ${inviteError.message}. If this person already has a Supabase Auth account, link it directly instead of inviting.` },
      { status: 400 }
    );
  }

  const { error: linkError } = await service
    .from('employees')
    .update({ auth_user_id: invite.user.id, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (linkError) {
    return NextResponse.json(
      { error: `Auth account created but linking employees.auth_user_id failed: ${linkError.message}. The auth.users row (id: ${invite.user.id}) exists but is orphaned — link it manually.` },
      { status: 207 }
    );
  }

  return NextResponse.json({ message: `Invite sent to ${employee.email}`, auth_user_id: invite.user.id });
}
