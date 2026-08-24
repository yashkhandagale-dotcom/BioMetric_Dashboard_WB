import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getPendingApprovalsCount } from '@/lib/leaveSupabase/getPendingApprovalsCount';
import LeaveShell from '@/components/leave/LeaveShell';

// Protects app/leave/attendance/** — feedback item: "Attendance days
// that need your input" (MyAttendanceExceptions) used to live as a card
// squeezed onto /leave/me; it now gets its own sidebar tab and its own
// page, same guard as /leave/me (every role except hr_super_admin, who
// is org-wide/remind-only and has no personal attendance of their own
// tracked here — mirrors why that role has no "My Leave" tab either).
export default async function LeaveAttendanceLayout({
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

  if (employee.role === 'hr_super_admin') {
    redirect('/leave/admin');
  }

  const supabase = await createLeaveClient();
  const pendingApprovalsCount = await getPendingApprovalsCount(supabase, employee);

  return (
    <LeaveShell employeeName={employee.full_name} role={employee.role} pendingApprovalsCount={pendingApprovalsCount}>
      {children}
    </LeaveShell>
  );
}
