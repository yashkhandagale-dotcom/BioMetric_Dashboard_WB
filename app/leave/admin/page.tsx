import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import { getEmployeeBalancesByFY } from '@/lib/leaveSupabase/getEmployeeBalances';
import EmployeeGrid from '@/components/leave/EmployeeGrid';
import type { EmployeeWithBalances } from '@/components/leave/EmployeeCard';

// This page used to show a plain balances-only table (Code/Name/Dept/
// Office/SL/CL/PL/LWP + an Adjust button) and link out to a separate
// /leave/admin/employees page for anything more detailed. Folded together
// now: this IS the employee page. Reasons for the merge:
//   - Employees are auto-onboarded from biometric CSV uploads now (see
//     lib/employeeStore.ts's ensureEmployeesFromAttendance), so the old
//     "Add Employee" form doesn't have a job to do anymore — nobody
//     manually creates a row here.
//   - The Adjust button (AdjustBalanceButton) grew a "Details" tab that
//     covers what the Add Employee form used to (status, role, reporting
//     tech lead / manager) — the only things a CSV can't supply — so
//     there's no remaining reason to keep a second page around for it.
//   - "Record Leave" and "Manage Employees" nav links here used to point
//     to the exact same URL (/leave/admin/employees) under two different
//     labels — a leftover, confusing duplicate, removed.
//   - "Seed Balances" is no longer triggered from the UI at all — leave
//     balance seeding now runs as a DB script directly, not a page action.
export default async function LeaveAdminHome() {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const fyStartYear = getFYStartYear();

  const [
    { data: employees, error: employeesError },
    { rows: balances, error: balancesError },
    { data: teams, error: teamsError },
  ] = await Promise.all([
    supabase
      .from('employees')
      .select(
        'id, employee_code, full_name, department, office, role, employment_status, date_of_joining, team_id, reporting_tech_lead_id, reporting_manager_id'
      )
      .order('full_name'),
    getEmployeeBalancesByFY(supabase, fyStartYear),
    supabase.from('teams').select('id, name, manager_id'),
  ]);

  const balancesById = new Map(balances.map((b) => [b.employeeId, b]));
  const employeesById = new Map((employees ?? []).map((e) => [e.id, e]));
  const teamsById = new Map((teams ?? []).map((t) => [t.id, t]));
  // Every team a given manager currently manages — the "auto-updated
  // everywhere" hierarchy is entirely driven off teams.manager_id, so this
  // is the single source of truth both for a manager's card and for every
  // team member's effective-manager lookup below.
  const teamsByManagerId = new Map<string, { id: string; name: string }[]>();
  for (const t of teams ?? []) {
    if (!t.manager_id) continue;
    const list = teamsByManagerId.get(t.manager_id) ?? [];
    list.push({ id: t.id, name: t.name });
    teamsByManagerId.set(t.manager_id, list);
  }

  const merged: EmployeeWithBalances[] = (employees ?? []).map((e) => {
    const b = balancesById.get(e.id);
    const team = e.team_id ? teamsById.get(e.team_id) : undefined;
    const effectiveManager = team?.manager_id ? employeesById.get(team.manager_id) : undefined;
    const techLead = e.reporting_tech_lead_id ? employeesById.get(e.reporting_tech_lead_id) : undefined;
    const reportingManager = e.reporting_manager_id ? employeesById.get(e.reporting_manager_id) : undefined;

    return {
      id: e.id,
      code: e.employee_code,
      name: e.full_name,
      department: e.department,
      office: e.office,
      role: e.role,
      employmentStatus: e.employment_status,
      dateOfJoining: e.date_of_joining,
      teamId: e.team_id,
      teamName: team?.name ?? null,
      // Derived, not stored — reassigning a team's manager changes this
      // for every member automatically, with no per-employee write.
      effectiveManagerName: e.role === 'manager' ? null : effectiveManager?.full_name ?? null,
      reportingTechLeadId: e.reporting_tech_lead_id,
      techLeadName: e.role === 'employee' ? techLead?.full_name ?? null : null,
      reportingManagerId: e.reporting_manager_id,
      reportingManagerName: e.role === 'manager' ? reportingManager?.full_name ?? null : null,
      managedTeams: e.role === 'manager' ? teamsByManagerId.get(e.id) ?? [] : [],
      SL: b?.SL ?? 0,
      CL: b?.CL ?? 0,
      PL: b?.PL ?? 0,
      LWP: b?.LWP ?? 0,
    };
  });

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <a href="/" className="text-xs text-slate-400 hover:text-white">← Back to Dashboard</a>
          <h1 className="text-xl font-semibold mt-1">Leave Balances — {formatFYLabel(fyStartYear)}</h1>
          <p className="text-slate-500 text-xs mt-1">Signed in as {user?.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/leave/admin/analytics"
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Leave Analytics
          </a>
          <a
            href="/leave/admin/history"
            className="border border-slate-700 hover:border-slate-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Leave History
          </a>
          <a
            href="/leave/admin/violations"
            className="border border-red-500/40 hover:border-red-400 text-red-300 hover:text-red-200 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Violations
          </a>
          <a
            href="/leave/admin/bulk-events"
            className="border border-slate-700 hover:border-slate-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Bulk Events
          </a>
        </div>
      </div>

      {(employeesError || balancesError || teamsError) && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {employeesError?.message || balancesError?.message || teamsError?.message}
        </div>
      )}

      <EmployeeGrid employees={merged} fyStartYear={fyStartYear} />
    </div>
  );
}