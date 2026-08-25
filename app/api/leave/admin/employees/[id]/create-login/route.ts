import { NextRequest, NextResponse } from 'next/server';
import { createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

// POST /api/leave/admin/employees/:id/create-login
//
// Referenced by two existing UI components — components/leave/
// EmployeeLoginButton.tsx (per-employee card, "Create Login" mode) and
// app/leave/admin/bulk-logins/CreateLoginForm.tsx (the routine
// one-at-a-time flow) — but the route itself didn't exist yet, so both
// buttons 404'd. This fills that gap, reusing the exact same
// createUser + email_confirm: true + link pattern
// app/api/leave/admin/employees/bulk-create-logins/route.ts already
// established (see that file's header comment for the reasoning: this
// IS the account, fully set up, no separate "confirm your email" step).
// This route is the single-employee version of that same idea.
//
// HR-only. No-op (409) if the employee already has a login — same
// "already linked" idempotency the CSV-bulk and invite routes both use,
// so this can't silently overwrite someone's existing password.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const password = String(body?.password ?? '');
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
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
  if (!employee.email) {
    return NextResponse.json({ error: 'This employee has no email on file — add one before creating a login.' }, { status: 400 });
  }
  if (employee.auth_user_id) {
    return NextResponse.json(
      { error: 'This employee already has a login. Use "Reset Password" instead.' },
      { status: 409 }
    );
  }

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: employee.email,
    password,
    email_confirm: true,
  });

  if (createError) {
    const alreadyExists = /already been registered|already exists|already registered/i.test(createError.message);
    return NextResponse.json(
      {
        error: alreadyExists
          ? 'An Auth account for this email already exists — link it manually via the Supabase dashboard, then try again.'
          : createError.message,
      },
      { status: 400 }
    );
  }

  const { error: linkError } = await service
    .from('employees')
    .update({
      auth_user_id: created.user.id,
      auth_provider: 'password',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (linkError) {
    return NextResponse.json(
      {
        error: `Account created (id: ${created.user.id}) but linking employees.auth_user_id failed: ${linkError.message}. The auth.users row exists but is orphaned — link it manually.`,
      },
      { status: 207 }
    );
  }

  return NextResponse.json({ message: `Login created for ${employee.full_name}. They can sign in with the password you set.` });
}
