import { redirect } from 'next/navigation';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getEmployeeBalanceBreakdown } from '@/lib/leaveSupabase/getEmployeeBalances';
import ApprovalCard, { PendingApprovalRequest } from '@/components/leave/ApprovalCard';

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
  employees: { full_name: string; employee_code: string; department: string; reporting_manager_id: string | null } | null;
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
  if (employee.role !== 'manager' && !isHr) {
    redirect('/leave/me');
  }

  const supabase = await createLeaveClient();

  let query = supabase
    .from('leave_requests')
    .select(
      `
      id, employee_id, start_date, end_date, is_half_day, half_day_session,
      total_days, reason, is_lwp_override, lwp_override_reason,
      employees!inner ( full_name, employee_code, department, reporting_manager_id ),
      leave_types ( code, display_name )
    `
    )
    .eq('status', 'pending')
    .order('start_date', { ascending: true });

  // HR sees every pending request org-wide (their own approve/reject
  // authorization already allows this); a manager only ever sees their
  // own direct reports — enforced the same way the Sprint A scaffold
  // already did.
  if (!isHr) {
    query = query.eq('employees.reporting_manager_id', employee.id);
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
        <p className="text-[var(--text-muted)] text-xs mb-1">Leave Tracker</p>
        <h1 className="text-xl font-semibold mb-1">Pending Approvals</h1>
        <p className="text-[var(--text-muted)] text-xs mb-6">
          {isHr ? 'All pending requests org-wide.' : 'Your direct reports\u2019 pending requests.'}
        </p>

        {error && (
          <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 mb-4">
            Could not load pending requests: {error.message}
          </div>
        )}

        {requests.length === 0 ? (
          <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-6 text-center text-[var(--text-muted)] text-sm">
            No pending requests right now.
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <ApprovalCard key={r.id} request={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}