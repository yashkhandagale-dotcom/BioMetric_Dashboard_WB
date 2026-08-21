import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import { getEmployeeBalancesByFY } from '@/lib/leaveSupabase/getEmployeeBalances';
import EmployeeGrid from '@/components/leave/EmployeeGrid';
import type { EmployeeWithBalances } from '@/components/leave/EmployeeCard';
import PolicyInfoButton from '@/components/leave/PolicyInfoButton';
import BulkEventsButton from '@/components/leave/BulkEventsButton';
import LeavePageHeader from '@/components/leave/LeavePageHeader';

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
//     lead / manager) — the only things a CSV can't supply — so
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
    { data: deptManagers, error: deptManagersError },
  ] = await Promise.all([
    supabase
      .from('employees')
      .select(
        'id, employee_code, full_name, department, office, role, employment_status, notice_period_days, date_of_joining, reporting_lead_id, reporting_manager_id, auth_user_id, email'
      )
      .order('full_name'),
    getEmployeeBalancesByFY(supabase, fyStartYear),
    supabase.from('department_managers').select('department, manager_id'),
  ]);

  const balancesById = new Map(balances.map((b) => [b.employeeId, b]));
  const employeesById = new Map((employees ?? []).map((e) => [e.id, e]));
  const managerIdByDept = new Map((deptManagers ?? []).map((d) => [d.department, d.manager_id]));
  // Every department a given manager currently manages — the
  // "auto-updated everywhere" hierarchy is entirely driven off
  // department_managers.manager_id, so this is the single source of
  // truth both for a manager's card and for every department member's
  // effective-manager lookup below
  const departmentsByManagerId = new Map<string, string[]>();
  for (const d of deptManagers ?? []) {
    if (!d.manager_id) continue;
    const list = departmentsByManagerId.get(d.manager_id) ?? [];
    list.push(d.department);
    departmentsByManagerId.set(d.manager_id, list);
  }

  const merged: EmployeeWithBalances[] = (employees ?? []).map((e) => {
    const b = balancesById.get(e.id);
    const effectiveManagerId = managerIdByDept.get(e.department) ?? null;
    const effectiveManager = effectiveManagerId ? employeesById.get(effectiveManagerId) : undefined;
    const lead = e.reporting_lead_id ? employeesById.get(e.reporting_lead_id) : undefined;
    const reportingManager = e.reporting_manager_id ? employeesById.get(e.reporting_manager_id) : undefined;

    return {
      id: e.id,
      code: e.employee_code,
      name: e.full_name,
      department: e.department,
      office: e.office,
      role: e.role,
      employmentStatus: e.employment_status,
      noticePeriodDays: e.notice_period_days,
      dateOfJoining: e.date_of_joining,
      hasLogin: !!e.auth_user_id,
      email: e.email,
      // Derived, not stored — reassigning a department's manager changes
      // this for every member automatically, with no per-employee write.
      effectiveManagerName: e.role === 'manager' ? null : effectiveManager?.full_name ?? null,
      reportingLeadId: e.reporting_lead_id,
      leadName: e.role === 'employee' ? lead?.full_name ?? null : null,
      reportingManagerId: e.reporting_manager_id,
      reportingManagerName: e.role === 'manager' ? reportingManager?.full_name ?? null : null,
      managedDepartments: e.role === 'manager' ? departmentsByManagerId.get(e.id) ?? [] : [],
      SL: b?.SL ?? 0,
      CL: b?.CL ?? 0,
      PL: b?.PL ?? 0,
      LWP: b?.LWP ?? 0,
    };
  });

  return (
    <div className="space-y-6">
      {/* Section-to-section navigation (Approvals, Analytics, Leave
          Tracker, Violations, Organization, Create Login, Change
          Password) lives in the persistent LeaveShell sidebar/tab strip
          — this header keeps only this page's own title and the two
          actions that are modals, not destinations (Bulk Events,
          Policy Info), so they don't get lost in a nav rail. */}
      <LeavePageHeader
        title={`Leave Balances — ${formatFYLabel(fyStartYear)}`}
        description={`Signed in as ${user?.email}`}
        actions={
          <>
            <BulkEventsButton />
            <PolicyInfoButton />
          </>
        }
      />

      {(employeesError || balancesError || deptManagersError) && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
          {employeesError?.message || balancesError?.message || deptManagersError?.message}
        </div>
      )}

      {/* Today's Absentees / Half Days moved to the Leave Tracker page
          (/leave/admin/history) as tabs alongside Leave History — see
          that page's header comment. This page stays focused on
          balances + read-only employee info. */}

      <EmployeeGrid employees={merged} fyStartYear={fyStartYear} />
    </div>
  );
}