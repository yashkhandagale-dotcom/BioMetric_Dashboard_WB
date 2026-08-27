import { requireLeaveAccess } from '@/lib/leaveSupabase/requireLeaveAccess';
import LeaveShell from '@/components/leave/LeaveShell';

// Protects app/leave/approvals/** — the pending-approval queue. Manager
// is the primary audience; HR / hr_super_admin can also reach it since
// HR has approve-anywhere override authority. Lead is treated as a
// mini-manager — approves their own direct reports the same way a
// manager does. Plain employee is bounced home.
//
// PERF/MAINTAINABILITY FIX: the guard logic itself now lives in one
// place (lib/leaveSupabase/requireLeaveAccess.ts) shared by every
// /leave/** layout — see that file's comment for why. getCurrentEmployee()
// is also now cache()'d, so this call and the one this route's page.tsx
// makes share a single auth lookup instead of each re-authenticating
// from scratch.
export default async function LeaveApprovalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { employee, pendingApprovalsCount } = await requireLeaveAccess({
    allowedRoles: ['manager', 'lead', 'hr', 'hr_super_admin'],
  });

  return (
    <LeaveShell employeeName={employee.full_name} role={employee.role} pendingApprovalsCount={pendingApprovalsCount}>
      {children}
    </LeaveShell>
  );
}
