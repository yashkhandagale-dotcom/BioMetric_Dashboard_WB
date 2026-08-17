import { redirect } from 'next/navigation';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getEmployeeBalanceBreakdown } from '@/lib/leaveSupabase/getEmployeeBalances';
import { getManagedEmployeeIds } from '@/lib/leaveSupabase/organization';
import { PendingApprovalRequest } from '@/components/leave/ApprovalCard';
import ApprovalsList from '@/components/leave/ApprovalsList';
import LeavePageHeader from '@/components/leave/LeavePageHeader';
import { PendingWfhRequest } from '@/components/leave/WfhApprovalCard';

type PendingRow = {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  is_half_day: boolean;
  half_day_session: string | null;
  total_days: number;
  reason: string;
  is_lwp_override: boolean;
  lwp_override_reason: string | null;
  employees: { full_name: string; employee_code: string; department: string; reporting_lead_id: string | null } | null;
  leave_types: { code: string; display_name: string } | null;
};


// B1 — real approval queue: one card per pending request from the
// logged-in manager's DIRECT reports only (reporting_manager_id, no
// recursive walk — same `.eq('employees.reporting_manager_id', ...)`
// filter the Sprint A scaffold already proved out, just with the full
// card data now). HR/HR-super-admin can also land here to review across
// all managers (mirrors the approve/reject routes' own HR-override
// authorization) — everyone else is redirected home.
export default async function LeaveApprovalsHome() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    redirect('/leave/login');
  }
  const isHr = employee.role === 'hr' || employee.role === 'hr_super_admin';
  const isHrSuperAdmin = employee.role === 'hr_super_admin';
  const isLead = employee.role === 'lead';
  const isManager = employee.role === 'manager';
  // HR Admin (hr_super_admin) is remind-only — can't approve/reject.
  // Everyone else who reaches this queue (manager/lead/hr) approves
  // directly and doesn't get a separate remind action.
  const canApprove = !isHrSuperAdmin;
  const canRemind = isHr;
  if (!isManager && !isLead && !isHr) {
    redirect('/leave/me');
  }

  const supabase = await createLeaveClient();

  // Manager's queue is scoped by department (department_managers — see
  // getManagedEmployeeIds's own comment for why that's the correct field,
  // not reporting_manager_id), computed before building the query since
  // Supabase's query builder can't express "IN this dynamically-sized set
  // of ids" as a single filter chained after an inner join the same way
  // reporting_lead_id's direct column match can.
  let managedIds: string[] = [];
  if (isManager) {
    const { employeeIds } = await getManagedEmployeeIds(supabase, employee.id);
    managedIds = employeeIds;
  }

  let query = supabase
    .from('leave_requests')
    .select(
      `
      id, employee_id, start_date, end_date, is_half_day, half_day_session,
      total_days, reason, is_lwp_override, lwp_override_reason,
      employees!inner ( full_name, employee_code, department, reporting_lead_id ),
      leave_types ( code, display_name )
    `
    )
    .eq('status', 'pending')
    .order('start_date', { ascending: true });

  // HR sees every pending request org-wide (their own approve/reject
  // authorization already allows this); a lead only sees their own direct
  // reports (reporting_lead_id, unchanged); a manager sees every pending
  // request from an employee/lead in a department they manage
  // (department_managers, via managedIds above) — single-login pivot:
  // lead is now a mini-manager with its own scoped queue, not just a
  // read-only role.
  if (isLead) {
    query = query.eq('employees.reporting_lead_id', employee.id);
  } else if (isManager) {
    query = managedIds.length > 0 ? query.in('employee_id', managedIds) : query.eq('employee_id', '00000000-0000-0000-0000-000000000000');
  }

  const { data: pending, error } = await query.returns<PendingRow[]>();

  const rows = (pending ?? []).filter((r) => r.employees && r.leave_types);

  // Feedback items #5/#6 — WFH requests join the same approvals queue,
  // scoped with the exact same rules as leave above (department_managers
  // for a manager, reporting_lead_id for a lead, org-wide for HR) since
  // approval routing for WFH reuses the identical
  // getEffectiveApproverId mechanism at write time — a Delivery-
  // department employee's WFH already lands with the Delivery manager
  // this way, no separate role needed.
  type PendingWfhRow = {
    id: string;
    start_date: string;
    end_date: string;
    is_half_day: boolean;
    half_day_session: string | null;
    reason: string;
    applied_on: string;
    employees: { full_name: string; employee_code: string; department: string; reporting_lead_id: string | null } | null;
  };

  let wfhQuery = supabase
    .from('wfh_requests')
    .select(
      `id, start_date, end_date, is_half_day, half_day_session, reason, applied_on,
       employees!inner ( full_name, employee_code, department, reporting_lead_id )`
    )
    .eq('status', 'pending')
    .order('start_date', { ascending: true });

  if (isLead) {
    wfhQuery = wfhQuery.eq('employees.reporting_lead_id', employee.id);
  } else if (isManager) {
    wfhQuery = managedIds.length > 0
      ? wfhQuery.in('employee_id', managedIds)
      : wfhQuery.eq('employee_id', '00000000-0000-0000-0000-000000000000');
  }

  const { data: pendingWfh } = await wfhQuery.returns<PendingWfhRow[]>();

  const wfhRequests: PendingWfhRequest[] = (pendingWfh ?? [])
    .filter((r) => r.employees)
    .map((r) => ({
      id: r.id,
      employeeName: r.employees!.full_name,
      employeeCode: r.employees!.employee_code,
      department: r.employees!.department,
      startDate: r.start_date,
      endDate: r.end_date,
      isHalfDay: r.is_half_day,
      halfDaySession: r.half_day_session,
      reason: r.reason,
      appliedOn: r.applied_on,
    }));

  // Current balance snapshot per request (B1) — reuses
  // getEmployeeBalanceBreakdown (A3's addition to getEmployeeBalances.ts),
  // no new balance math. One call per distinct employee in the queue
  // rather than per row, since a person can have more than one pending
  // request.
  const balanceByEmployee = new Map<string, Awaited<ReturnType<typeof getEmployeeBalanceBreakdown>>['rows']>();
  await Promise.all(
    Array.from(new Set(rows.map((r) => r.employee_id))).map(async (employeeId) => {
      const { rows: breakdown } = await getEmployeeBalanceBreakdown(supabase, employeeId);
      balanceByEmployee.set(employeeId, breakdown);
    })
  );

  const requests: PendingApprovalRequest[] = rows.map((r) => {
    const balances = balanceByEmployee.get(r.employee_id) ?? [];
    const balanceForType = balances.find((b) => b.code === r.leave_types!.code);
    return {
      id: r.id,
      employeeName: r.employees!.full_name,
      employeeCode: r.employees!.employee_code,
      department: r.employees!.department,
      leaveTypeCode: r.leave_types!.code,
      leaveTypeLabel: r.leave_types!.display_name,
      startDate: r.start_date,
      endDate: r.end_date,
      isHalfDay: r.is_half_day,
      halfDaySession: r.half_day_session,
      totalDays: r.total_days,
      reason: r.reason,
      isLwpOverride: r.is_lwp_override,
      lwpOverrideReason: r.lwp_override_reason,
      currentBalance: balanceForType?.remaining ?? null,
    };
  });

  return (
    <div className="max-w-3xl space-y-6">
      <LeavePageHeader
        title={
          <span className="flex items-center gap-2">
            Pending Approvals
            {(requests.length + wfhRequests.length) > 0 && (
              <span className="inline-flex items-center justify-center bg-amber-500 text-white text-xs font-bold rounded-full min-w-[1.4rem] h-[1.4rem] px-1.5">
                {requests.length + wfhRequests.length}
              </span>
            )}
          </span>
        }
        description={isHr ? 'All pending requests org-wide.' : 'Your direct reports\u2019 pending requests.'}
      />

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 mb-4">
          Could not load pending requests: {error.message}
        </div>
      )}

      <ApprovalsList requests={requests} wfhRequests={wfhRequests} isHr={isHr} canApprove={canApprove} canRemind={canRemind} />
    </div>
  );
}