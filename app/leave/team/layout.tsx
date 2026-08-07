import { redirect } from 'next/navigation';
import { getCurrentEmployee, homeRouteForRole } from '@/lib/leaveSupabase/getCurrentEmployee';

// Protects app/leave/team/** — the read-only leave-records view of a
// manager or lead's own team (plan section 2/3): roster + balances +
// leave history, no edit actions anywhere.
//
// Single-login pivot: opened up to manager as well as lead (was
// lead-only). Reachable from both the approvals queue ("Leave Tracker
// (Team)" button) and /leave/me ("Team Dashboard" goes to the main
// attendance Dashboard instead — this page is specifically the Leave
// Tracker's own read-only team view, the equivalent of what HR gets at
// /leave/admin but scoped and non-editable). HR already has the org-wide
// equivalent at /leave/admin, so HR is bounced there instead of shown
// this narrower version.
export default async function LeaveTeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const employee = await getCurrentEmployee();

  if (!employee) {
    redirect('/leave/login');
  }

  if (employee.role !== 'lead' && employee.role !== 'manager') {
    redirect(homeRouteForRole(employee.role));
  }

  return <>{children}</>;
}
