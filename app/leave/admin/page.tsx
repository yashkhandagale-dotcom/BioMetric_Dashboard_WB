import Link from 'next/link';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import { getEmployeeBalancesByFY } from '@/lib/leaveSupabase/getEmployeeBalances';
import EmployeeGrid from '@/components/leave/EmployeeGrid';
import type { EmployeeWithBalances } from '@/components/leave/EmployeeCard';
import PolicyInfoButton from '@/components/leave/PolicyInfoButton';
import BulkEventsButton from '@/components/leave/BulkEventsButton';

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
    { count: pendingApprovalsCount },
  ] = await Promise.all([
    supabase
      .from('employees')
      .select(
        'id, employee_code, full_name, department, office, role, employment_status, notice_period_days, date_of_joining, reporting_lead_id, reporting_manager_id, auth_user_id, email'
      )
      .order('full_name'),
    getEmployeeBalancesByFY(supabase, fyStartYear),
    supabase.from('department_managers').select('department, manager_id'),
    supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);

  const balancesById = new Map(balances.map((b) => [b.employeeId, b]));
  const employeesById = new Map((employees ?? []).map((e) => [e.id, e]));
  const managerIdByDept = new Map((deptManagers ?? []).map((d) => [d.department, d.manager_id]));
  // Every department a given manager currently manages — the
  // "auto-updated everywhere" hierarchy is entirely driven off
  // department_managers.manager_id, so this is the single source of
  // truth both for a manager's card and for every department member's
  // effective-manager lookup below.
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
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">← Back to Dashboard</Link>
          <h1 className="text-xl font-semibold mt-1">Leave Balances — {formatFYLabel(fyStartYear)}</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">Signed in as {user?.email}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/leave/approvals"
            className="relative bg-amber-600/20 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-sm font-medium px-4 py-2 rounded-lg hover:bg-amber-600/30 transition-colors"
          >
            Pending Approvals
            {!!pendingApprovalsCount && (
              <span className="ml-1.5 inline-flex items-center justify-center bg-amber-500 text-white text-[10px] font-bold rounded-full min-w-[1.1rem] h-[1.1rem] px-1">
                {pendingApprovalsCount}
              </span>
            )}
          </Link>
          <Link
            href="/leave/admin/analytics"
            className="bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Leave Analytics
          </Link>
          <Link
            href="/leave/admin/history"
            className="border border-[var(--border)] hover:border-[var(--border)] text-[var(--text-primary)] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Leave Tracker
          </Link>
          <Link
            href="/leave/admin/violations"
            className="border border-red-500/40 hover:border-red-400 text-red-700 dark:text-red-300 hover:text-red-700 dark:hover:text-red-200 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Violations
          </Link>
          <BulkEventsButton />
          <Link
            href="/leave/admin/organization"
            className="border border-[var(--border)] hover:border-[var(--border)] text-[var(--text-primary)] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Organization
          </Link>
          <Link
            href="/leave/admin/bulk-logins"
            className="border border-[var(--border)] hover:border-[var(--border)] text-[var(--text-primary)] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Create Login
          </Link>
          <Link
            href="/leave/change-password"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm font-medium px-3 py-2 rounded-lg transition-colors"
          >
            Change Password
          </Link>
          <PolicyInfoButton />
        </div>
      </div>

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