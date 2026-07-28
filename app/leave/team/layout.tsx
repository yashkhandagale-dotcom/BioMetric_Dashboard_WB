import { redirect } from 'next/navigation';
import { getCurrentEmployee, homeRouteForRole } from '@/lib/leaveSupabase/getCurrentEmployee';

// Protects app/leave/team/** — the lead's read-only view of their direct
// reports' leave (plan section 2/3). Lead-only for now: manager and HR
// already get an org-wide equivalent (approvals queue / admin calendar),
// so they're bounced to their own home rather than shown a second,
// narrower version of the same information. Revisit if HR/manager ever
// want this exact "my direct reports" slice too.
export default async function LeaveTeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const employee = await getCurrentEmployee();

  if (!employee) {
    redirect('/leave/login');
  }

  if (employee.role !== 'lead') {
    redirect(homeRouteForRole(employee.role));
  }

  return <>{children}</>;
}
