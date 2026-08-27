import { requireLeaveAccess } from '@/lib/leaveSupabase/requireLeaveAccess';
import LeaveShell from '@/components/leave/LeaveShell';

// Protects app/leave/team/** — the read-only leave-records view of a
// manager or lead's own team: roster + balances + leave history, no
// edit actions anywhere.
//
// Single-login pivot: opened up to manager as well as lead (was
// lead-only). HR already has the org-wide equivalent at /leave/admin,
// so HR is bounced there instead of shown this narrower version.
//
// PERF/MAINTAINABILITY FIX: the guard logic itself now lives in one
// place (lib/leaveSupabase/requireLeaveAccess.ts) shared by every
// /leave/** layout — see that file's comment for why. getCurrentEmployee()
// is also now cache()'d, so this call and the one this route's page.tsx
// makes share a single auth lookup instead of each re-authenticating
// from scratch.
export default async function LeaveTeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { employee, pendingApprovalsCount } = await requireLeaveAccess({
    allowedRoles: ['lead', 'manager'],
  });

  return (
    <LeaveShell employeeName={employee.full_name} role={employee.role} pendingApprovalsCount={pendingApprovalsCount}>
      {children}
    </LeaveShell>
  );
}
