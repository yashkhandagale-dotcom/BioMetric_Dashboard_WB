import { createLeaveClient } from '@/lib/leaveSupabase/server';

export type EmployeeRole = 'employee' | 'lead' | 'manager' | 'hr' | 'hr_super_admin';

export interface CurrentEmployee {
  id: string;
  full_name: string;
  employee_code: string;
  email: string;
  role: EmployeeRole;
  department: string;
  office: string;
  reporting_lead_id: string | null;
  reporting_manager_id: string | null;
}

// Sprint A — role-aware auth.
//
// Every route guard under app/leave/** should call this instead of just
// checking `supabase.auth.getUser()`. It answers two questions in one
// round trip: "is there a session?" and "which employees row (and
// therefore which role) does it map to?".
//
// Returns null in two distinct cases that callers should treat the same
// way (redirect to /leave/login): no session at all, OR a session whose
// auth_user_id has no matching employees row yet (e.g. an account was
// created in Supabase Auth directly, bypassing the admin invite flow in
// app/api/leave/admin/employees/[id]/invite/route.ts, so it was never
// linked). We deliberately do not distinguish these to the caller — both
// are "not a recognized employee session" from the app's point of view.
//
// NOTE — this only gates page routing. The `employees` table's RLS policy
// is still the wide-open "authenticated read/write" policy from
// 001_leave_management_schema.sql (see schema.sql:713) — i.e. any
// authenticated Supabase user can already read/write any row via a direct
// client call, regardless of what this function decides. That RLS
// tightening is real, separate work (flagged for Sprint C/G, since it
// mainly matters once the approval endpoints exist) — do not treat page
// guards built on top of this helper as a data-access boundary yet.
export async function getCurrentEmployee(): Promise<CurrentEmployee | null> {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: employee, error } = await supabase
    .from('employees')
    .select(
      'id, full_name, employee_code, email, role, department, office, reporting_lead_id, reporting_manager_id'
    )
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error || !employee) return null;

  return employee as CurrentEmployee;
}

// Where each role lands right after login / when they hit a route their
// role doesn't own. Centralized here so the single /login page and every
// layout guard agree on the same mapping instead of each hardcoding it.
//
// Single-login pivot: hr / hr_super_admin now land on the unified
// Dashboard ('/') — that's the whole point of merging the two logins
// (see middleware.ts's header comment and PROGRESS.md point 5). A
// "Leave Tracker" button in the Dashboard header (app/DashboardClient.tsx)
// gets them to '/leave/admin' from there for full read/write access.
//
// manager and lead both land on '/leave/me' first — their own leave data
// — with an "Approve Team Leaves" button to '/leave/approvals' and a
// "Team Dashboard" button to '/' (read-only, filtered to their team) from
// there. Treated identically here per the confirmed decision that lead
// should behave like a mini-manager, not a lesser role.
export function homeRouteForRole(role: EmployeeRole): string {
  switch (role) {
    case 'hr':
    case 'hr_super_admin':
      return '/';
    case 'manager':
    case 'lead':
    case 'employee':
    default:
      return '/leave/me';
  }
}
