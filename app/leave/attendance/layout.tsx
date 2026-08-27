import { requireLeaveAccess } from '@/lib/leaveSupabase/requireLeaveAccess';
import LeaveShell from '@/components/leave/LeaveShell';

// Protects app/leave/attendance/** — feedback item: "Attendance days
// that need your input" (MyAttendanceExceptions) used to live as a card
// squeezed onto /leave/me; it now gets its own sidebar tab and its own
// page, same guard as /leave/me (every role except hr_super_admin, who
// is org-wide/remind-only and has no personal attendance of their own
// tracked here — mirrors why that role has no "My Leave" tab either).
//
// PERF/MAINTAINABILITY FIX: the guard logic itself now lives in one
// place (lib/leaveSupabase/requireLeaveAccess.ts) shared by every
// /leave/** layout, instead of being pasted into each one — see that
// file's comment for why. getCurrentEmployee() is also now cache()'d,
// so this call and the one this route's page.tsx makes share a single
// auth lookup instead of each re-authenticating from scratch.
export default async function LeaveAttendanceLayout({
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
