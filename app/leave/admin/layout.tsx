import { redirect } from 'next/navigation';
import { getCurrentEmployee, homeRouteForRole } from '@/lib/leaveSupabase/getCurrentEmployee';

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

  if (employee.role !== 'hr' && employee.role !== 'hr_super_admin') {
    redirect(homeRouteForRole(employee.role));
  }

  return <>{children}</>;
}