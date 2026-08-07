import { redirect } from 'next/navigation';
import { getCurrentEmployee, homeRouteForRole } from '@/lib/leaveSupabase/getCurrentEmployee';

// Protects app/leave/approvals/** — the pending-approval queue (plan
// section 2/5a). Manager is the primary audience; HR / hr_super_admin
// can also reach it since the plan gives HR override approval anywhere
// (section 2's "Can approve: can override anywhere").
//
// Revised decision (single-login pivot, superseding the original
// "confirmed assumption #1: manager is the sole approver, lead is
// notified only"): lead is now treated as a mini-manager — approves
// their own direct reports the same way a manager does — rather than
// being a pure read-only role. See app/leave/approvals/page.tsx for the
// matching query-scoping change (reporting_lead_id vs
// reporting_manager_id). Plain employee is still bounced home.
export default async function LeaveApprovalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const employee = await getCurrentEmployee();

  if (!employee) {
    redirect('/leave/login');
  }

  if (!['manager', 'lead', 'hr', 'hr_super_admin'].includes(employee.role)) {
    redirect(homeRouteForRole(employee.role));
  }

  return <>{children}</>;
}
