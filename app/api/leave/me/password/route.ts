import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';

// POST /api/leave/me/password — any logged-in employee changes their own
// password, proving they know the current one first.
//
// Supabase Auth's updateUser() doesn't ask for the current password on
// its own (a valid session is enough to change it), so "old password
// required" is enforced here explicitly: re-authenticate with
// signInWithPassword using the CURRENT session's email + the submitted
// old password before calling updateUser. If that re-auth fails, nothing
// is changed. This also clears must_change_password, so a temp password
// HR set only forces this flow once, not on every login after.
export async function POST(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const oldPassword = String(body?.old_password ?? '');
  const newPassword = String(body?.new_password ?? '');

  if (!oldPassword) {
    return NextResponse.json({ error: 'Current password is required.' }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: 'New password must be at least 6 characters.' }, { status: 400 });
  }
  if (newPassword === oldPassword) {
    return NextResponse.json({ error: 'New password must be different from your current password.' }, { status: 400 });
  }

  // Re-authentication proves "old password" without ever storing/reading
  // it ourselves — Supabase Auth remains the only place a password hash
  // lives. signInWithPassword on the same client also refreshes this
  // session's tokens, which is fine (the caller already has a valid
  // session, this doesn't change who's logged in).
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: oldPassword,
  });
  if (verifyError) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  const { error: clearFlagError } = await supabase
    .from('employees')
    .update({ must_change_password: false, updated_at: new Date().toISOString() })
    .eq('auth_user_id', user.id);
  if (clearFlagError) {
    // Password itself is already changed successfully — this is a
    // secondary bookkeeping write, don't fail the request over it.
    return NextResponse.json({ message: 'Password changed.', warning: clearFlagError.message });
  }

  return NextResponse.json({ message: 'Password changed.' });
}
