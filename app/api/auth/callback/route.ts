import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { homeRouteForRole, type EmployeeRole } from '@/lib/leaveSupabase/getCurrentEmployee';

// GET /api/auth/callback — Supabase Google OAuth redirects here with a
// `?code=...` after the person approves on Google's consent screen (see
// app/login/page.tsx: signInWithOAuth({ provider: 'google', options: {
// redirectTo: `${origin}/api/auth/callback` } })).
//
// This is the ONLY place account linking happens for Google sign-in — it
// deliberately reuses the exact same "employee record is the one source
// of truth for role, auth_user_id is the link" model the password/invite
// flow already uses (see app/api/leave/admin/employees/[id]/invite/
// route.ts and lib/leaveSupabase/getCurrentEmployee.ts's header comment).
// Google only ever proves "this person controls this email address" —
// it never creates an employee record and never decides a role.
//
// Rules (see the task's sections 1–3, and the simplified onboarding
// follow-up — see 0017_pending_signups_and_probation.sql):
//   - @wonderbiz.in email + a matching employees row  -> link (if not
//     already linked) and let them in.
//   - @wonderbiz.in email + NO matching employees row  -> create/refresh
//     a pending_employee_signups row (name/email/photo only — nothing
//     HR-owned) and send them to a friendly holding page. This is NOT
//     "auto-creating a full employee master record" (still explicitly
//     avoided) — it's a queue entry HR acts on at app/leave/admin (see
//     the "New sign-ins awaiting setup" panel).
//   - Non-@wonderbiz.in email                          -> only allowed if
//     it matches an EXISTING employees row whose role is hr or
//     hr_super_admin. That row only exists because HR/Admin deliberately
//     created it with that email (via the Admin panel's Add Employee
//     form or a DB edit) — that act of creation IS the "explicitly
//     configured Admin/HR account" the spec asks for (section 1). Any
//     other external email is rejected outright, no pending row created.
const COMPANY_EMAIL_DOMAIN = (process.env.COMPANY_EMAIL_DOMAIN || 'wonderbiz.in').toLowerCase();

function errorRedirect(origin: string, code: string) {
  const url = new URL('/login', origin);
  url.searchParams.set('error', code);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const { origin, searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next');

  if (!code) {
    return errorRedirect(origin, 'oauth_missing_code');
  }

  const supabase = await createClient();
  const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !sessionData?.user) {
    return errorRedirect(origin, 'oauth_exchange_failed');
  }

  const user = sessionData.user;
  const email = (user.email || '').toLowerCase();
  const googleId = user.user_metadata?.provider_id || user.user_metadata?.sub || null;
  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;

  if (!email) {
    await supabase.auth.signOut();
    return errorRedirect(origin, 'oauth_no_email');
  }

  const domain = email.split('@')[1] || '';
  const isCompanyDomain = domain === COMPANY_EMAIL_DOMAIN;

  // Service client: linking auth_user_id and reading across the whole
  // employees table must not depend on the wide-open "authenticated"
  // RLS policy staying exactly as permissive as it is today (see
  // unified_schema.sql Section 4 / lib/leaveSupabase/getCurrentEmployee.ts's
  // RLS note) — this route's own authorization logic below IS the access
  // control here, same pattern every other admin-only route already uses.
  const service = createServiceClient();

  const { data: employee, error: lookupError } = await service
    .from('employees')
    .select('id, email, role, auth_user_id, google_id, profile_confirmed_at, must_change_password')
    .ilike('email', email)
    .maybeSingle();

  if (lookupError) {
    await supabase.auth.signOut();
    return errorRedirect(origin, 'oauth_lookup_failed');
  }

  if (!employee) {
    // Section 3 (still honored): never silently create a full employee
    // master record from a bare login. But the person DID just prove
    // they own a real @wonderbiz.in Google account — rather than a dead
    // end, that's exactly the signal HR wants to see. Upsert a
    // deliberately minimal pending_employee_signups row (name/email/
    // photo only, nothing HR-owned — see 0017_pending_signups_and_
    // probation.sql's header comment) and send them to the holding
    // page. Signing in again before HR acts just refreshes this same
    // row (unique on auth_user_id), never creates a duplicate.
    //
    // Non-company domains still get no pending row at all — those are
    // rejected outright, same as before.
    if (!isCompanyDomain) {
      await supabase.auth.signOut();
      return errorRedirect(origin, 'unauthorized_email');
    }

    const { error: pendingError } = await service.from('pending_employee_signups').upsert(
      {
        auth_user_id: user.id,
        email,
        full_name: user.user_metadata?.full_name || user.user_metadata?.name || email,
        avatar_url: avatarUrl,
        google_id: googleId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'auth_user_id' }
    );

    if (pendingError) {
      await supabase.auth.signOut();
      return errorRedirect(origin, 'oauth_lookup_failed');
    }

    return NextResponse.redirect(new URL('/leave/pending', origin));
  }

  const isAdminRole = employee.role === 'hr' || employee.role === 'hr_super_admin';
  if (!isCompanyDomain && !isAdminRole) {
    // An employees row happens to exist with this email (unlikely, but
    // possible from bad data), but it's neither a company email nor an
    // explicitly-configured admin/HR account — do not let it in.
    await supabase.auth.signOut();
    return errorRedirect(origin, 'unauthorized_email');
  }

  if (employee.auth_user_id && employee.auth_user_id !== user.id) {
    // This email is already linked to a DIFFERENT Supabase auth account
    // (e.g. an existing password-based account created before Google
    // login existed). Do not silently repoint it — that would let a new
    // Google identity hijack an existing linked account by email
    // coincidence. HR needs to resolve this explicitly.
    await supabase.auth.signOut();
    return errorRedirect(origin, 'already_linked_elsewhere');
  }

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    last_login_at: nowIso,
    updated_at: nowIso,
  };
  if (!employee.auth_user_id) {
    // First Google login for this existing employee record — the "Find
    // employee by email -> Link auth_user_id" step from section 5.
    update.auth_user_id = user.id;
  }
  if (googleId && employee.google_id !== googleId) {
    update.google_id = googleId;
  }
  if (avatarUrl) {
    update.avatar_url = avatarUrl;
  }
  // Only flip auth_provider to 'google' the first time — an existing
  // password user who also signs in with Google once shouldn't lose the
  // ability to reason about "were they originally a password account?"
  // from this field alone if that distinction ever matters later. Simpler
  // and matches how must_change_password only ever narrows, not widens.
  if (!employee.auth_user_id) {
    update.auth_provider = 'google';
  }

  const { error: linkError } = await service.from('employees').update(update).eq('id', employee.id);
  if (linkError) {
    await supabase.auth.signOut();
    return errorRedirect(origin, 'link_failed');
  }

  // Routing, same precedence every other /leave/** layout guard already
  // uses (must_change_password gates everything — see e.g.
  // app/leave/me/layout.tsx), with the new profile-confirmation step
  // slotted in right after it, before any role-specific home route.
  if (employee.must_change_password) {
    return NextResponse.redirect(new URL('/leave/change-password', origin));
  }
  if (!employee.profile_confirmed_at) {
    const url = new URL('/leave/onboarding', origin);
    if (next) url.searchParams.set('next', next);
    return NextResponse.redirect(url);
  }

  const destination = next || homeRouteForRole(employee.role as EmployeeRole);
  return NextResponse.redirect(new URL(destination, origin));
}
