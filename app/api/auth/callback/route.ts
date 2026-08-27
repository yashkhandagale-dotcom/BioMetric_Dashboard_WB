import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  homeRouteForRole,
  type EmployeeRole,
} from '@/lib/leaveSupabase/getCurrentEmployee';

// GET /api/auth/callback — Supabase Google OAuth redirects here with a
// `?code=...` after the person approves on Google's consent screen.
//
// Login rules:
//   1. Existing employee matched by email
//      -> link Google account and login directly.
//
//   2. Existing employee whose email is not populated in employees,
//      but whose full_name matches firstname.lastname@wonderbiz.in
//      -> link Google account and login directly.
//
//   3. @wonderbiz.in account with no matching employee
//      -> create/refresh pending_employee_signups and send to /leave/pending.
//
//   4. Non-company email
//      -> only allowed for an explicitly configured HR/HR Super Admin account.
//
// Existing employees do NOT need acknowledgement/onboarding just because
// profile_confirmed_at is NULL. If the employee record already exists,
// Google sign-in is treated as a normal login.

const COMPANY_EMAIL_DOMAIN = (
  process.env.COMPANY_EMAIL_DOMAIN || 'wonderbiz.in'
).toLowerCase();

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

  const {
    data: sessionData,
    error: exchangeError,
  } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !sessionData?.user) {
    return errorRedirect(origin, 'oauth_exchange_failed');
  }

  const user = sessionData.user;

  const email = (user.email || '').trim().toLowerCase();

  const googleId =
    user.user_metadata?.provider_id ||
    user.user_metadata?.sub ||
    null;

  const avatarUrl =
    user.user_metadata?.avatar_url ||
    user.user_metadata?.picture ||
    null;

  if (!email) {
    await supabase.auth.signOut();
    return errorRedirect(origin, 'oauth_no_email');
  }

  const domain = email.split('@')[1] || '';
  const isCompanyDomain = domain === COMPANY_EMAIL_DOMAIN;

  // Service client is intentionally used here because this route needs
  // to identify/link employee records independently of normal client RLS.
  const service = createServiceClient();

  // -------------------------------------------------------------------------
  // STEP 1: Try exact email match
  // -------------------------------------------------------------------------

  let { data: employee, error: lookupError } = await service
    .from('employees')
    .select(
      'id, full_name, email, role, auth_user_id, google_id, profile_confirmed_at, must_change_password'
    )
    .ilike('email', email)
    .maybeSingle();

  if (lookupError) {
    await supabase.auth.signOut();
    return errorRedirect(origin, 'oauth_lookup_failed');
  }

  // -------------------------------------------------------------------------
  // STEP 2: Fallback for existing company employees whose email is NULL
  //
  // Example:
  //
  //   Google email:
  //     sakshi.gangurde@wonderbiz.in
  //
  //   Derived name:
  //     Sakshi Gangurde
  //
  //   employees.full_name:
  //     Sakshi Gangurde
  //
  // If exactly one employee matches, that existing employee is used.
  // -------------------------------------------------------------------------

  if (!employee && isCompanyDomain) {
    const localPart = email.split('@')[0];

    const nameParts = localPart
      .split('.')
      .map((part) => part.trim())
      .filter(Boolean);

    if (nameParts.length >= 2) {
      const firstName = nameParts[0];

      // Everything after the first dot is treated as the last-name portion.
      //
      // This also supports:
      //   sai.kumar.sharma@wonderbiz.in
      //
      // -> Sai Kumar Sharma
      const lastName = nameParts.slice(1).join(' ');

      const derivedFullName = `${firstName} ${lastName}`
        .replace(/\s+/g, ' ')
        .trim();

      const {
        data: nameMatches,
        error: nameLookupError,
      } = await service
        .from('employees')
        .select(
          'id, full_name, email, role, auth_user_id, google_id, profile_confirmed_at, must_change_password'
        )
        .ilike('full_name', derivedFullName)
        .limit(2);

      if (nameLookupError) {
        await supabase.auth.signOut();
        return errorRedirect(origin, 'oauth_lookup_failed');
      }

      // Only automatically link when the name uniquely identifies
      // one employee. Never guess if duplicate names exist.
      if (nameMatches?.length === 1) {
        employee = nameMatches[0];
      }
    }
  }

  // -------------------------------------------------------------------------
  // STEP 3: No existing employee found
  //
  // Only genuinely new @wonderbiz.in users reach this section.
  // They remain in the HR acknowledgement/setup flow.
  // -------------------------------------------------------------------------

  if (!employee) {
    if (!isCompanyDomain) {
      await supabase.auth.signOut();
      return errorRedirect(origin, 'unauthorized_email');
    }

    const { error: pendingError } = await service
      .from('pending_employee_signups')
      .upsert(
        {
          auth_user_id: user.id,
          email,
          full_name:
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            email,
          avatar_url: avatarUrl,
          google_id: googleId,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'auth_user_id',
        }
      );

    if (pendingError) {
      await supabase.auth.signOut();
      return errorRedirect(origin, 'oauth_lookup_failed');
    }

    return NextResponse.redirect(
      new URL('/leave/pending', origin)
    );
  }

  // -------------------------------------------------------------------------
  // STEP 4: Existing employee found
  // -------------------------------------------------------------------------

  const isAdminRole =
    employee.role === 'hr' ||
    employee.role === 'hr_super_admin';

  if (!isCompanyDomain && !isAdminRole) {
    await supabase.auth.signOut();
    return errorRedirect(origin, 'unauthorized_email');
  }

  // Never silently steal an employee record that is already linked
  // to another Supabase auth account.
  if (
    employee.auth_user_id &&
    employee.auth_user_id !== user.id
  ) {
    await supabase.auth.signOut();
    return errorRedirect(origin, 'already_linked_elsewhere');
  }

  // -------------------------------------------------------------------------
  // STEP 5: Link/update the existing employee
  // -------------------------------------------------------------------------

  const nowIso = new Date().toISOString();

  const update: Record<string, unknown> = {
    // Important: because we successfully matched the existing employee
    // through their company email/name, populate the email now.
    email,

    last_login_at: nowIso,
    updated_at: nowIso,

    // Existing employee = normal login.
    // profile_confirmed_at must NOT block login.
    //
    // We mark the legacy confirmation gate as satisfied so older code
    // cannot redirect an existing employee into onboarding.
    profile_confirmed_at:
      employee.profile_confirmed_at || nowIso,
  };

  // First Google login for this employee.
  if (!employee.auth_user_id) {
    update.auth_user_id = user.id;
    update.auth_provider = 'google';
  }

  if (googleId && employee.google_id !== googleId) {
    update.google_id = googleId;
  }

  if (avatarUrl) {
    update.avatar_url = avatarUrl;
  }

  const { error: linkError } = await service
    .from('employees')
    .update(update)
    .eq('id', employee.id);

  if (linkError) {
    await supabase.auth.signOut();
    return errorRedirect(origin, 'link_failed');
  }

  // -------------------------------------------------------------------------
  // STEP 6: Remove stale pending signup
  //
  // This handles cases where the employee previously signed in before
  // their employee record was created/imported.
  // -------------------------------------------------------------------------

  await service
    .from('pending_employee_signups')
    .delete()
    .eq('auth_user_id', user.id);

  // -------------------------------------------------------------------------
  // STEP 7: Existing employee -> DIRECT LOGIN
  //
  // There is deliberately NO acknowledgement/onboarding step here.
  // -------------------------------------------------------------------------

  const destination =
    next ||
    homeRouteForRole(employee.role as EmployeeRole);

  return NextResponse.redirect(
    new URL(destination, origin)
  );
}