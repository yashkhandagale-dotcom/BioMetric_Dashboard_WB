import { redirect } from 'next/navigation';
import { getCurrentEmployee, homeRouteForRole, getPendingSignupRedirect } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getPendingApprovalsCount } from '@/lib/leaveSupabase/getPendingApprovalsCount';
import LeaveShell from '@/components/leave/LeaveShell';

// Protects everything under app/leave/admin/**. Deliberately a layout,
// not middleware.ts — this only runs for this route subtree, so it can
// never affect the existing dashboard routes or its auth flow.
//
// Sprint A: the "any authenticated user IS the HR super admin" shortcut
// this used to implement is gone. Now it's a real role check against the
// employees table (via getCurrentEmployee): only `hr` / `hr_super_admin`
// get through. Everyone else — including a valid employee/lead/manager
// session — is bounced to their own home route, not to /leave/login,
// since they *are* authenticated, just not authorized for this subtree.
// A session with no employees row at all (not yet linked, or a stray
// Supabase Auth account) still goes to /leave/login.
//
// Navigation chrome (sidebar / mobile tab strip / theme toggle / user
// menu) now comes from LeaveShell, the same shell every other /leave/**
// subtree renders — this used to be the one section with a persistent
// nav rail (the old LeaveAdminSidebar) while every other section had
// none at all, which was the single biggest source of pages looking
// like they were built by different developers.
export default async function LeaveAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const employee = await getCurrentEmployee();

  if (!employee) {
    // Simplified onboarding: a Google sign-in with no employees row yet
    // isn't necessarily unauthenticated — it may be someone waiting on
    // HR to acknowledge them (see app/api/auth/callback/route.ts and
    // 0017_pending_signups_and_probation.sql). Send those to the
    // holding page instead of bouncing them back to /login.
    const pendingRedirect = await getPendingSignupRedirect();
    redirect(pendingRedirect || '/leave/login');
  }

  if (employee.must_change_password) {
    redirect('/leave/change-password');
  }

  // Google OAuth first-login (see app/api/auth/callback/route.ts and
  // 0016_google_oauth_and_directory.sql) — confirm/edit the
  // employee-editable fields once before reaching any /leave/** page.
  // Same precedence slot as must_change_password above.
  if (!employee.profile_confirmed_at) {
    redirect('/leave/onboarding');
  }

  if (employee.role !== 'hr' && employee.role !== 'hr_super_admin') {
    redirect(homeRouteForRole(employee.role));
  }

  // Pending-approvals badge shown on the shell's "Approvals" tab — same
  // count app/leave/admin/page.tsx already used to compute for its own
  // header button, lifted here so it's visible from every /leave/admin/**
  // page, not just the balances home page.
  const supabase = await createLeaveClient();
  const pendingApprovalsCount = await getPendingApprovalsCount(supabase, employee);

  return (
    <LeaveShell employeeName={employee.full_name} role={employee.role} pendingApprovalsCount={pendingApprovalsCount}>
      {children}
    </LeaveShell>
  );
}
