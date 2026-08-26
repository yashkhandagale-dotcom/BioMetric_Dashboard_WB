import { NextRequest, NextResponse } from 'next/server';
import { createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

// POST /api/leave/admin/employees/:id/reset-password
//
// Sibling to .../create-login (see that file's header comment for why
// both were missing and are added together) — referenced by
// components/leave/EmployeeLoginButton.tsx's "Reset Password" mode.
//
// Sets a new (temporary) password directly via the admin API and flips
// must_change_password back on, reusing the EXISTING forced-change gate
// every /leave/** layout already enforces (see e.g.
// app/leave/me/layout.tsx) and the existing change-password screen
// (app/leave/change-password/page.tsx + components/leave/
// ChangePasswordForm.tsx) — no new password mechanism, just driving the
// one that's already there.
//
// HR-only. 404s if there's no employee, 409s if this employee has no
// login yet (nothing to reset — HR should use "Create Login" first).
// A Google-only account (auth_provider = 'google', no password ever
// set) can still have a password force-set here — this hands them a
// fallback password login without touching their Google link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const newPassword = String(body?.new_password ?? '');
  if (newPassword.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }

  const service = createLeaveServiceClient();

  const { data: employee, error: fetchError } = await service
    .from('employees')
    .select('id, full_name, auth_user_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  }
  if (!employee.auth_user_id) {
    return NextResponse.json(
      { error: 'This employee has no login yet. Use "Create Login" instead.' },
      { status: 409 }
    );
  }

  const { error: updateError } = await service.auth.admin.updateUserById(employee.auth_user_id, {
    password: newPassword,
  });
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  const { error: flagError } = await service
    .from('employees')
    .update({ must_change_password: true, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (flagError) {
    return NextResponse.json({
      message: 'Password reset, but the "must change password" flag could not be set.',
      warning: flagError.message,
    });
  }

  return NextResponse.json({
    message: `Password reset for ${employee.full_name}. They'll be asked to set a new one at next login.`,
  });
}
