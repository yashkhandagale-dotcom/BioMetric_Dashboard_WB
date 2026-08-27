import { requireLeaveAccess } from '@/lib/leaveSupabase/requireLeaveAccess';
import LeaveShell from '@/components/leave/LeaveShell';

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
//
// Navigation chrome (sidebar / mobile tab strip / theme toggle / user
// menu) comes from LeaveShell, the same shell every other /leave/**
// subtree renders.
//
// PERF/MAINTAINABILITY FIX: the guard logic itself now lives in one
// place (lib/leaveSupabase/requireLeaveAccess.ts) shared by every
// /leave/** layout — see that file's comment for why. getCurrentEmployee()
// is also now cache()'d, so this call and the one this route's page.tsx
// makes share a single auth lookup instead of each re-authenticating
// from scratch.
export default async function LeaveAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { employee, pendingApprovalsCount } = await requireLeaveAccess({
    allowedRoles: ['hr', 'hr_super_admin'],
  });

  return (
    <LeaveShell employeeName={employee.full_name} role={employee.role} pendingApprovalsCount={pendingApprovalsCount}>
      {children}
    </LeaveShell>
  );
}
