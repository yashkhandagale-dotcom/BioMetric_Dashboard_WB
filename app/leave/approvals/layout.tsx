import { redirect } from 'next/navigation';
import { getCurrentEmployee, homeRouteForRole } from '@/lib/leaveSupabase/getCurrentEmployee';
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
    redirect('/leave/login');
  }

  if (employee.must_change_password) {
    redirect('/leave/change-password');
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
