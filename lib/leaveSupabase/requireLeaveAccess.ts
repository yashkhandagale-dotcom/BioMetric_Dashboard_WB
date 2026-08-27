import { redirect } from 'next/navigation';
import {
  getCurrentEmployee,
  getPendingSignupRedirect,
  homeRouteForRole,
  type CurrentEmployee,
  type EmployeeRole,
} from './getCurrentEmployee';
import { createLeaveClient } from './server';
import { getPendingApprovalsCount } from './getPendingApprovalsCount';

export interface LeaveAccessResult {
  employee: CurrentEmployee;
  pendingApprovalsCount: number;
}

export interface RequireLeaveAccessOptions {
  /**
   * If set, only these roles may proceed — everyone else is redirected to
   * their own home route (not to /leave/login, since they ARE a recognized,
   * authenticated employee, just not authorized for this subtree). Omit
   * this to allow every recognized role through (e.g. /leave/me).
   */
  allowedRoles?: EmployeeRole[];
  /**
   * If set, an hr_super_admin is redirected here BEFORE the allowedRoles
   * check runs — used by /leave/me and /leave/attendance, which are
   * personal-attendance pages hr_super_admin has no personal data for.
   */
  redirectHrSuperAdminTo?: string;
}

// Bug fix (drift risk): this is the exact same precedence chain that used
// to be pasted, nearly verbatim, into every app/leave/**/layout.tsx file
// (admin, me, team, approvals, attendance) — five copies that had already
// drifted from each other once before (see the file history / PROGRESS.md
// for the split-env-var and split-cookie bugs that came from exactly this
// kind of duplication). Centralizing it here means:
//   1. A fix like the getCurrentEmployee()/createLeaveClient() cache()
//      wrapping only has to be reasoned about in one place.
//   2. Any future auth-flow change (a new onboarding step, a new role)
//      is made once and every /leave/** subtree picks it up automatically,
//      instead of someone needing to remember to touch five files.
//
// Precedence (unchanged from the original per-layout logic):
//   no employees row  -> /leave/pending (if a pending signup exists) or /leave/login
//   must_change_password -> /leave/change-password
//   !profile_confirmed_at -> /leave/onboarding
//   redirectHrSuperAdminTo (if configured) -> that route, for hr_super_admin
//   allowedRoles (if configured) -> homeRouteForRole(employee.role) if not included
export async function requireLeaveAccess(
  options: RequireLeaveAccessOptions = {}
): Promise<LeaveAccessResult> {
  const employee = await getCurrentEmployee();

  if (!employee) {
    // Simplified onboarding: a Google sign-in with no employees row yet
    // isn't necessarily unauthenticated — it may be someone waiting on HR
    // to acknowledge them (see app/api/auth/callback/route.ts and
    // 0017_pending_signups_and_probation.sql). Send those to the holding
    // page instead of bouncing them back to /login.
    const pendingRedirect = await getPendingSignupRedirect();
    redirect(pendingRedirect || '/leave/login');
  }

  if (employee.must_change_password) {
    redirect('/leave/change-password');
  }

  // Google OAuth first-login (see app/api/auth/callback/route.ts and
  // 0016_google_oauth_and_directory.sql) — confirm/edit the
  // employee-editable fields once before reaching any /leave/** page.
  if (!employee.profile_confirmed_at) {
    redirect('/leave/onboarding');
  }

  if (options.redirectHrSuperAdminTo && employee.role === 'hr_super_admin') {
    redirect(options.redirectHrSuperAdminTo);
  }

  if (options.allowedRoles && !options.allowedRoles.includes(employee.role)) {
    redirect(homeRouteForRole(employee.role));
  }

  // Pending-approvals badge shown on the shell's "Approvals" tab — computed
  // once here so it's available to every /leave/** subtree's LeaveShell.
  const supabase = await createLeaveClient();
  const pendingApprovalsCount = await getPendingApprovalsCount(supabase, employee);

  return { employee, pendingApprovalsCount };
}
