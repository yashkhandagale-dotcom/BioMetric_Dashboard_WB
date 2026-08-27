import { requireLeaveAccess } from '@/lib/leaveSupabase/requireLeaveAccess';
import LeaveShell from '@/components/leave/LeaveShell';

// Protects app/leave/me/** — employee self-service: apply, own balance,
// own history, personal calendar.
//
// Every role is allowed in here, including lead/manager/hr — everyone is
// also "an employee" with their own leave to apply for and track — except
// hr_super_admin (HR Admin), who is org-wide/remind-only and has no
// personal leave of their own tracked here; the tab is hidden for them in
// LeaveShell, and this guard backs that up so the route itself redirects
// instead of just being unlinked.
//
// PERF/MAINTAINABILITY FIX: the guard logic itself now lives in one
// place (lib/leaveSupabase/requireLeaveAccess.ts) shared by every
// /leave/** layout — see that file's comment for why. getCurrentEmployee()
// is also now cache()'d, so this call and the one this route's page.tsx
// makes share a single auth lookup instead of each re-authenticating
// from scratch.
export default async function LeaveMeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { employee, pendingApprovalsCount } = await requireLeaveAccess({
    redirectHrSuperAdminTo: '/leave/admin',
  });

  return (
    <LeaveShell employeeName={employee.full_name} role={employee.role} pendingApprovalsCount={pendingApprovalsCount}>
      {children}
    </LeaveShell>
  );
}
