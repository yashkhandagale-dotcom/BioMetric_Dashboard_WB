import { redirect } from 'next/navigation';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getEmployeeBalanceBreakdown } from '@/lib/leaveSupabase/getEmployeeBalances';
import { getManagedEmployeeIds } from '@/lib/leaveSupabase/organization';
import { PendingApprovalRequest } from '@/components/leave/ApprovalCard';
import ApprovalsList from '@/components/leave/ApprovalsList';
import Link from 'next/link';

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
  const isLead = employee.role === 'lead';
  const isManager = employee.role === 'manager';
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
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
          <div>
            <Link href={isHr ? '/leave/admin' : '/leave/me'} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              ← {isHr ? 'Back to Leave Management' : 'Back to My Leave'}
            </Link>
            <p className="text-[var(--text-muted)] text-xs mt-1 mb-1">Leave Tracker</p>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              Pending Approvals
              {requests.length > 0 && (
                <span className="inline-flex items-center justify-center bg-amber-500 text-white text-xs font-bold rounded-full min-w-[1.4rem] h-[1.4rem] px-1.5">
                  {requests.length}
                </span>
              )}
            </h1>
          </div>
          {!isHr && (
            <div className="flex items-center gap-2">
              <Link
                href="/leave/team"
                className="flex items-center gap-1.5 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-600/30 transition-colors"
                title="Read-only leave records for your team"
              >
                Leave Tracker (Team)
              </Link>
              <Link
                href="/leave/me"
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] px-3 py-1.5 rounded-lg text-xs transition-colors"
              >
                My Leave
              </Link>
            </div>
          )}
        </div>
        <p className="text-[var(--text-muted)] text-xs mb-6">
          {isHr ? 'All pending requests org-wide.' : 'Your direct reports\u2019 pending requests.'}
        </p>

        {error && (
          <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 mb-4">
            Could not load pending requests: {error.message}
          </div>
        )}

        <ApprovalsList requests={requests} isHr={isHr} />
      </div>
    </div>
  );
}