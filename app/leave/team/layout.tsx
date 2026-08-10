import { redirect } from 'next/navigation';
import { getCurrentEmployee, homeRouteForRole } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getPendingApprovalsCount } from '@/lib/leaveSupabase/getPendingApprovalsCount';
import LeaveShell from '@/components/leave/LeaveShell';

// Protects app/leave/team/** — the read-only leave-records view of a
// manager or lead's own team: roster + balances + leave history, no
// edit actions anywhere.
//
// Single-login pivot: opened up to manager as well as lead (was
// lead-only). HR already has the org-wide equivalent at /leave/admin,
// so HR is bounced there instead of shown this narrower version.
//
// Same LeaveShell as every other /leave/** subtree — this page used to
// carry its own inline "Pending Approvals" / "My Leave" link buttons in
// its header; those are gone now that the sidebar/tab strip already
// covers both destinations everywhere, all the time.
export default async function LeaveTeamLayout({
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

  if (employee.role !== 'lead' && employee.role !== 'manager') {
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
