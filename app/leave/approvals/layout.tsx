import { redirect } from 'next/navigation';
import { getCurrentEmployee, homeRouteForRole } from '@/lib/leaveSupabase/getCurrentEmployee';

// Protects app/leave/approvals/** — the manager's pending-approval queue
// (plan section 2/5a). Manager is the primary audience; HR / hr_super_admin
// can also reach it since the plan gives HR override approval anywhere
// (section 2's "Can approve: can override anywhere"). Lead and employee
// are bounced home — confirmed assumption #1: manager is the sole
// approver, lead is notified only, not a gate in the chain.
export default async function LeaveApprovalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const employee = await getCurrentEmployee();

  if (!employee) {
    redirect('/leave/login');
  }

  if (!['manager', 'hr', 'hr_super_admin'].includes(employee.role)) {
    redirect(homeRouteForRole(employee.role));
  }

  return <>{children}</>;
}
