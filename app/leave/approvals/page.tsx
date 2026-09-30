import { redirect } from 'next/navigation';
import { ClipboardCheck, AlertCircle } from 'lucide-react';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getEmployeeBalanceBreakdown } from '@/lib/leaveSupabase/getEmployeeBalances';
import { getManagedEmployeeIds } from '@/lib/leaveSupabase/organization';
import { listRegularisationsForEmployees } from '@/lib/leaveSupabase/regularisation';
import { PendingApprovalRequest } from '@/components/leave/ApprovalCard';
import ApprovalsList from '@/components/leave/ApprovalsList';
import LeavePageHeader from '@/components/leave/LeavePageHeader';
import { PendingWfhRequest } from '@/components/leave/WfhApprovalCard';
import { PendingRegularisationRequest } from '@/components/leave/RegularisationApprovalCard';
import { PendingMissedPunchRequest } from '@/components/leave/MissedPunchApprovalCard';

// Always fetch fresh — pending requests must appear the moment they're
// submitted, no cached version is acceptable here.
export const dynamic = 'force-dynamic';

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

type RawMissedPunchRow = {
  id: string;
  employee_id: string;
  exception_date: string;
  exception_type: string;
  first_punch: string | null;
  last_punch: string | null;
  employee_note: string | null;
  updated_at: string;
  employees: { full_name: string; employee_code: string; department: string; reporting_lead_id: string | null } | null;
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
  // Use service role for the actual data queries so RLS never hides a
  // pending request from HR (even if an RLS policy on leave_requests
  // doesn't cover all auth.uid() combinations for the HR user's session).
  // Authorization scoping (which employees a manager/lead/HR can see) is
  // enforced below in the application layer, not via RLS.
  const queryClient = isHr ? createLeaveServiceClient() : supabase;

  // Manager's queue is scoped by department (department_managers — see
  // getManagedEmployeeIds's own comment for why that's the correct field,
  // not reporting_manager_id), computed before building the query since
  // Supabase's query builder can't express "IN this dynamically-sized set
  // of ids" as a single filter chained after an inner join the same way
  // Manager's queue is scoped by department (department_managers — see
  // getManagedEmployeeIds's own comment for why that's the correct field,
  // not reporting_manager_id).
  let managedIds: string[] = [];
  let regularisationEmployeeIds: string[] = [];

  if (isManager) {
    const { employeeIds } = await getManagedEmployeeIds(supabase, employee.id);
    managedIds = employeeIds;
    regularisationEmployeeIds = employeeIds;
  } else if (isHr) {
    const { data: allEmployees } = await queryClient.from('employees').select('id');
    regularisationEmployeeIds = (allEmployees ?? []).map((e) => e.id);
  } else if (isLead) {
    const { data: reports } = await supabase.from('employees').select('id').eq('reporting_lead_id', employee.id);
    regularisationEmployeeIds = (reports ?? []).map((r) => r.id);
  }

  let query = queryClient
    .from('leave_requests')
    .select(
      `
      id, employee_id, start_date, end_date, is_half_day, half_day_session,
      total_days, reason, is_lwp_override, lwp_override_reason,
      employees!leave_requests_employee_id_fkey!inner ( full_name, employee_code, department, reporting_lead_id ),
      leave_types ( code, display_name )
    `
    )
    .eq('status', 'pending')
    .order('start_date', { ascending: true });

  let wfhQuery = queryClient
    .from('wfh_requests')
    .select(
      `id, start_date, end_date, is_half_day, half_day_session, reason, applied_on,
       employees!wfh_requests_employee_id_fkey!inner ( full_name, employee_code, department, reporting_lead_id )`
    )
    .eq('status', 'pending')
    .order('start_date', { ascending: true });

  let mpQuery = queryClient
    .from('attendance_exceptions')
    .select(
      `id, employee_id, exception_date, exception_type, first_punch, last_punch, employee_note, updated_at,
       employees!attendance_exceptions_employee_id_fkey!inner ( full_name, employee_code, department, reporting_lead_id )`
    )
    .eq('employee_choice', 'missed_punch')
    .order('exception_date', { ascending: false });

  if (isLead) {
    query = query.eq('employees.reporting_lead_id', employee.id);
    wfhQuery = wfhQuery.eq('employees.reporting_lead_id', employee.id);
    mpQuery = mpQuery.eq('employees.reporting_lead_id', employee.id);
  } else if (isManager) {
    if (managedIds.length > 0) {
      query = query.in('employee_id', managedIds);
      wfhQuery = wfhQuery.in('employee_id', managedIds);
      mpQuery = mpQuery.in('employee_id', managedIds);
    } else {
      const dummyId = '00000000-0000-0000-0000-000000000000';
      query = query.eq('employee_id', dummyId);
      wfhQuery = wfhQuery.eq('employee_id', dummyId);
      mpQuery = mpQuery.eq('employee_id', dummyId);
    }
  }

  // PERF: Execute all 4 approval queue data queries in parallel
  const [
    { data: pending, error },
    { data: pendingWfh, error: wfhError },
    { rows: regularisationRows },
    { data: rawMissedPunches, error: mpError },
  ] = await Promise.all([
    query.returns<PendingRow[]>(),
    wfhQuery.returns<PendingWfhRow[]>(),
    listRegularisationsForEmployees(queryClient, regularisationEmployeeIds),
    mpQuery.returns<RawMissedPunchRow[]>(),
  ]);

  const rows = (pending ?? []).filter((r) => r.employees && r.leave_types);

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

  const regularisationRequests: PendingRegularisationRequest[] = regularisationRows
    .filter((r) => r.status === 'pending')
    .map((r) => ({
      id: r.id,
      employeeName: r.employeeName,
      employeeCode: r.employeeCode,
      date: r.date,
      reason: r.reason,
      createdAt: r.createdAt,
    }));

  // Current balance snapshot per request (B1) — reuses
  // getEmployeeBalanceBreakdown (A3's addition to getEmployeeBalances.ts),
  // no new balance math. One call per distinct employee in the queue
  // rather than per row, since a person can have more than one pending
  // request.
  const balanceByEmployee = new Map<string, Awaited<ReturnType<typeof getEmployeeBalanceBreakdown>>['rows']>();
  await Promise.all(
    Array.from(new Set(rows.map((r) => r.employee_id))).map(async (employeeId) => {
      const { rows: breakdown } = await getEmployeeBalanceBreakdown(queryClient, employeeId);
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

  // Missed Punch entries (self-resolved exceptions) — mapped from parallel query result
  const missedPunchRequests: PendingMissedPunchRequest[] = (rawMissedPunches ?? [])
    .filter((r) => r.employees)
    .map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.employees!.full_name,
      employeeCode: r.employees!.employee_code,
      department: r.employees!.department,
      exceptionDate: r.exception_date,
      exceptionType: r.exception_type,
      firstPunch: r.first_punch,
      lastPunch: r.last_punch,
      note: r.employee_note ?? '',
      submittedAt: r.updated_at,
    }));

  const totalPending = requests.length + wfhRequests.length + regularisationRequests.length;

  // Raw Postgres/PostgREST error text (relationship names, constraint
  // names, etc.) is an implementation detail, not something a manager
  // reading this page should see — log it server-side for debugging and
  // show a plain, actionable message in the UI instead.
  if (error) console.error('[LeaveApprovalsHome] leave_requests query failed:', error);
  if (wfhError) console.error('[LeaveApprovalsHome] wfh_requests query failed:', wfhError);
  if (mpError) console.error('[LeaveApprovalsHome] attendance_exceptions query failed:', mpError);
  const anyLoadError = error || wfhError;

  return (
    <div className="max-w-5xl space-y-6">
      <LeavePageHeader
        icon={<ClipboardCheck className="h-5 w-5" />}
        title={
          <span className="flex items-center gap-2">
            Pending Approvals
            {totalPending > 0 && (
              <span className="inline-flex items-center justify-center bg-amber-500 text-white text-xs font-bold rounded-full min-w-[1.4rem] h-[1.4rem] px-1.5">
                {totalPending}
              </span>
            )}
          </span>
        }
        description={isHr ? 'All pending requests org-wide.' : 'Your direct reports\u2019 pending requests.'}
      />

      {anyLoadError && (
        <div className="flex items-start gap-2 text-sm rounded-xl px-4 py-3 border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            {error && wfhError
              ? 'Could not load some pending leave and WFH requests. Please refresh, or contact support if this persists.'
              : error
                ? 'Could not load pending leave requests. Please refresh, or contact support if this persists.'
                : 'Could not load pending WFH requests. Please refresh, or contact support if this persists.'}
          </p>
        </div>
      )}

      <ApprovalsList
        requests={requests}
        wfhRequests={wfhRequests}
        regularisationRequests={regularisationRequests}
        missedPunchRequests={missedPunchRequests}
        isHr={isHr}
        canApprove={canApprove}
        canRemind={canRemind}
      />
    </div>
  );
}