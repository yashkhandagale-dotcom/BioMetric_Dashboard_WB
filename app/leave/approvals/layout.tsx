import { redirect } from 'next/navigation';
import { getCurrentEmployee, homeRouteForRole, getPendingSignupRedirect } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getPendingApprovalsCount } from '@/lib/leaveSupabase/getPendingApprovalsCount';
import LeaveShell from '@/components/leave/LeaveShell';

// Protects app/leave/approvals/** — the pending-approval queue. Manager
// is the primary audience; HR / hr_super_admin can also reach it since
// HR has approve-anywhere override authority. Lead is treated as a
// mini-manager — approves their own direct reports the same way a
// manager does. Plain employee is bounced home.
//
// Same LeaveShell as every other /leave/** subtree, so the "Approvals"
// tab (with its own live pending-count badge) is always visible and
// always highlighted correctly, whether you're on this page or came
// from My Team / My Leave / any admin page.
export default async function LeaveApprovalsLayout({
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

  if (!['manager', 'lead', 'hr', 'hr_super_admin'].includes(employee.role)) {
    redirect(homeRouteForRole(employee.role));
  }

  const supabase = await createLeaveClient();
  const pendingApprovalsCount = await getPendingApprovalsCount(supabase, employee);

  return (
    <LeaveShell employeeName={employee.full_name} role={employee.role} pendingApprovalsCount={pendingApprovalsCount}>
      {children}
    </LeaveShell>
  );
}
