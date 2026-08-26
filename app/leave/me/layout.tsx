import { redirect } from 'next/navigation';
import { getCurrentEmployee, getPendingSignupRedirect } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getPendingApprovalsCount } from '@/lib/leaveSupabase/getPendingApprovalsCount';
import LeaveShell from '@/components/leave/LeaveShell';

// Protects app/leave/me/** — employee self-service: apply, own balance,
// own history, personal calendar.
//
// Every role is allowed in here, including lead/manager/hr — everyone is
// also "an employee" with their own leave to apply for and track — except
// hr_super_admin (HR Admin), who is org-wide/remind-only and has no
// personal leave of their own tracked here; the tab is hidden for them in
// LeaveShell, and this guard backs that up so the route itself 403s
// instead of just being unlinked.
//
// Renders the same LeaveShell every other /leave/** subtree renders, so
// "My Leave" always sits inside the same persistent sidebar/tab strip as
// Approvals, My Team, and (for HR) the admin sections — instead of this
// being the one page with its own bespoke MeNavbar-driven header and no
// way to reach anywhere else without typing a URL.
export default async function LeaveMeLayout({
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

  if (employee.role === 'hr_super_admin') {
    redirect('/leave/admin');
  }

  const supabase = await createLeaveClient();
  const pendingApprovalsCount = await getPendingApprovalsCount(supabase, employee);

  return (
    <LeaveShell employeeName={employee.full_name} role={employee.role} pendingApprovalsCount={pendingApprovalsCount}>
      {children}
    </LeaveShell>
  );
}
