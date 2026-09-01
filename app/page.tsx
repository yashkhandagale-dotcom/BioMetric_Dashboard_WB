import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getManagedEmployeeIds } from '@/lib/leaveSupabase/organization';
import DashboardClient from './DashboardClient';

// Single-login pivot — the Dashboard's entry point is now a Server
// Component so the auth/role decision happens before any client code
// runs, instead of the old client-only page guessing "any session = HR".
//
// Role → what they get:
//   - hr / hr_super_admin : full Dashboard (DashboardClient renders
//     HRDashboard — upload, export, settings, everything, unchanged).
//   - manager / lead        : NOT redirected away — rendered a read-only
//     view of the Dashboard scoped to their own team (direct reports),
//     per the confirmed decision to reuse the existing read-only
//     ManagerView UI with the underlying records filtered rather than
//     building a second dashboard. See DashboardClient.tsx's 'team' mode.
//   - employee               : never reaches this component at all —
//     middleware.ts already redirects them to /leave/me before this
//     runs. The redirect below is a second, redundant guard for the one
//     path middleware doesn't cover (the legacy ?view=1 share-link query
//     param bypasses middleware's role check on purpose — see
//     middleware.ts — so this still needs its own check for the
//     non-share-link case).
//   - no session at all      : sent to the single /login page.
//
// The legacy unauthenticated share-link view (?view=1&token=...) is left
// completely alone here — it's handled entirely client-side in
// DashboardClient (see that file), exactly as before this pivot, since
// it was never gated by a login in the first place (FR-10, gated by an
// unguessable token instead).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  if (sp.view === '1') {
    // Share-link path — no server-side auth/role lookup at all, by design.
    return <DashboardClient role={null} />;
  }

  const employee = await getCurrentEmployee();
  if (!employee) {
    redirect('/login');
  }
  if (employee.role === 'employee') {
    redirect('/leave/me');
  }

  let teamCodes: string[] | undefined;
  let managedDepartments: string[] | undefined;
  if (employee.role === 'manager' || employee.role === 'lead') {
    const supabase = await createLeaveClient();
    if (employee.role === 'manager') {
      const { employeeIds, departments } = await getManagedEmployeeIds(supabase, employee.id);
      managedDepartments = departments;
      if (employeeIds.length > 0) {
        const { data: reports } = await supabase.from('employees').select('employee_code').in('id', employeeIds);
        teamCodes = (reports ?? []).map((r) => r.employee_code);
      } else {
        teamCodes = [];
      }
    } else {
      const { data: reports } = await supabase
        .from('employees')
        .select('employee_code, department')
        .eq('reporting_lead_id', employee.id);
      teamCodes = (reports ?? []).map((r) => r.employee_code);
      managedDepartments = Array.from(new Set((reports ?? []).map((r) => r.department).filter(Boolean)));
    }
  }

  const role = employee.role === 'hr' || employee.role === 'hr_super_admin' ? 'hr' : employee.role;

  return <DashboardClient role={role} teamCodes={teamCodes} managedDepartments={managedDepartments} />;
}
