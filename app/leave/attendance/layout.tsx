import { redirect } from 'next/navigation';
import { getCurrentEmployee, getPendingSignupRedirect } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getPendingApprovalsCount } from '@/lib/leaveSupabase/getPendingApprovalsCount';
import LeaveShell from '@/components/leave/LeaveShell';

// Protects app/leave/attendance/** — feedback item: "Attendance days
// that need your input" (MyAttendanceExceptions) used to live as a card
// squeezed onto /leave/me; it now gets its own sidebar tab and its own
// page, same guard as /leave/me (every role except hr_super_admin, who
// is org-wide/remind-only and has no personal attendance of their own
// tracked here — mirrors why that role has no "My Leave" tab either).
export default async function LeaveAttendanceLayout({
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
