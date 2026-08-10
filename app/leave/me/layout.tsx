import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getPendingApprovalsCount } from '@/lib/leaveSupabase/getPendingApprovalsCount';
import LeaveShell from '@/components/leave/LeaveShell';

// Protects app/leave/me/** — employee self-service: apply, own balance,
// own history, personal calendar.
//
// Every role is allowed in here, including lead/manager/hr — everyone is
// also "an employee" with their own leave to apply for and track. The
// only requirement is a linked employees row at all.
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
    redirect('/leave/login');
  }

  if (employee.must_change_password) {
    redirect('/leave/change-password');
  }

  const supabase = await createLeaveClient();
  const pendingApprovalsCount = await getPendingApprovalsCount(supabase, employee);

  return (
    <LeaveShell employeeName={employee.full_name} role={employee.role} pendingApprovalsCount={pendingApprovalsCount}>
      {children}
    </LeaveShell>
  );
}
