import { redirect } from 'next/navigation';
import { getCurrentEmployee, homeRouteForRole } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import LeaveAdminSidebar from '@/components/leave/LeaveAdminSidebar';

// Protects everything under app/leave/admin/**. Deliberately a layout,
// not middleware.ts — this only runs for this route subtree, so it can
// never affect the existing dashboard routes or its auth flow.
//
// Sprint A: the "any authenticated user IS the HR super admin" shortcut
// this used to implement is gone. Now it's a real role check against the
// employees table (via getCurrentEmployee): only `hr` / `hr_super_admin`
// get through. Everyone else — including a valid employee/lead/manager
// session — is bounced to their own home route, not to /leave/login,
// since they *are* authenticated, just not authorized for this subtree.
// A session with no employees row at all (not yet linked, or a stray
// Supabase Auth account) still goes to /leave/login.
export default async function LeaveAdminLayout({
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

  if (employee.role !== 'hr' && employee.role !== 'hr_super_admin') {
    redirect(homeRouteForRole(employee.role));
  }

  // Sidebar's pending-approvals badge — same count app/leave/admin/page.tsx
  // already computes for its own "Pending Approvals" button, just lifted
  // here so it's visible from every /leave/admin/** page, not just the
  // balances home page.
  const supabase = await createLeaveClient();
  const { count: pendingApprovalsCount } = await supabase
    .from('leave_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  return (
    <div className="flex min-h-screen">
      <LeaveAdminSidebar pendingApprovalsCount={pendingApprovalsCount ?? 0} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}