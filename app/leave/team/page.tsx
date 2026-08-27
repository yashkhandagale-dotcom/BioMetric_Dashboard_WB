import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getEmployeeBalancesByFY } from '@/lib/leaveSupabase/getEmployeeBalances';
import { getManagedEmployeeIds } from '@/lib/leaveSupabase/organization';
import { getEmployeesOnLeaveToday } from '@/lib/leaveSupabase/onLeaveToday';
import { listRegularisationsForEmployees } from '@/lib/leaveSupabase/regularisation';
import { selectAllRows } from '@/lib/attendanceExceptions';
import { LeaveHistoryRow } from '@/components/leave/LeaveHistoryTable';
import LeavePageHeader from '@/components/leave/LeavePageHeader';
import TeamTabs from '@/components/leave/TeamTabs';

type HistoryRow = {
  id: string;
  start_date: string;
  end_date: string;
  is_half_day: boolean;
  half_day_session: string | null;
  total_days: number;
  status: string;
  source: string;
  is_lwp_override: boolean;
  applied_on: string;
  employees: { id: string; full_name: string; employee_code: string; department: string; office: string } | null;
  leave_types: { code: string; display_name: string } | null;
};

// Single-login pivot — the manager/lead's read-only "Leave Tracker" view
// (linked from /leave/approvals as "Leave Tracker (Team)"), the scoped
// equivalent of what HR gets at /leave/admin: roster with live SL/CL/PL/
// LWP balances, plus every leave request for the team. No record/edit/
// approve actions anywhere on this page on purpose — approving happens on
// /leave/approvals, recording leave is HR-only at /leave/admin. This page
// only ever reads.
//
// Scope: a manager's team is every employee/lead in a department they
// manage (department_managers — see getManagedEmployeeIds's comment for
// why that's the correct field, not reporting_manager_id); a lead's team
// is their direct reports (reporting_lead_id, unchanged — that one really
// is a per-employee field, set by bulk_assign_lead).
//
// UI note: the four data surfaces below (On Leave Today, Recent
// Regularisations, Roster & Balances, Team Leave History) live in a
// TeamTabs client component instead of four stacked full-width sections —
// one tab visible at a time instead of a long scroll, and it's the only
// place search/pagination state can live since this page itself is a
// Server Component. All the data is still fetched once, here, server-side;
// TeamTabs just paginates/filters the already-fetched arrays client-side
// rather than issuing new requests per page/search.
export default async function LeaveTeamHome() {
  const employee = await getCurrentEmployee();
  const supabase = await createLeaveClient();

  let reports: { id: string; full_name: string; employee_code: string; department: string; office: string }[] = [];
  let reportsError: { message: string } | null = null;

  if (employee?.role === 'manager') {
    const { employeeIds, error } = await getManagedEmployeeIds(supabase, employee.id);
    if (error) {
      reportsError = { message: error };
    } else if (employeeIds.length > 0) {
      const { data, error: fetchError } = await supabase
        .from('employees')
        .select('id, full_name, employee_code, department, office')
        .in('id', employeeIds)
        .order('full_name');
      reports = data ?? [];
      reportsError = fetchError;
    }
  } else {
    const { data, error } = await supabase
      .from('employees')
      .select('id, full_name, employee_code, department, office')
      .eq('reporting_lead_id', employee?.id ?? '')
      .order('full_name');
    reports = data ?? [];
    reportsError = error;
  }

  const teamIds = (reports ?? []).map((r) => r.id);

  const [{ rows: balances }, historyResult] = await Promise.all([
    getEmployeeBalancesByFY(supabase),
    teamIds.length > 0
      ? selectAllRows<HistoryRow>((from, to) =>
          supabase
            .from('leave_requests')
            .select(
              `
              id, start_date, end_date, is_half_day, half_day_session, total_days,
              status, source, is_lwp_override, applied_on,
              employees!leave_requests_employee_id_fkey ( id, full_name, employee_code, department, office ),
              leave_types ( code, display_name )
            `
            )
            .in('employee_id', teamIds)
            .order('start_date', { ascending: false })
            .range(from, to)
            .returns<HistoryRow[]>()
        )
      : Promise.resolve({ data: [] as HistoryRow[], error: null }),
  ]);

  const teamBalances = balances.filter((b) => teamIds.includes(b.employeeId));

  // Fetch onLeaveToday, regularisations, and pendingApprovalsCount
  const [{ rows: onLeaveToday }, { rows: regularisations }, pendingApprovalsResult] = await Promise.all([
    teamIds.length > 0 ? getEmployeesOnLeaveToday(supabase, undefined, teamIds) : Promise.resolve({ rows: [], error: null }),
    teamIds.length > 0 ? listRegularisationsForEmployees(supabase, teamIds) : Promise.resolve({ rows: [], error: null }),
    teamIds.length > 0
      ? supabase.from('leave_requests').select('id', { count: 'exact', head: true }).in('employee_id', teamIds).eq('status', 'pending')
      : Promise.resolve({ count: 0, error: null }),
  ]);

  const pendingApprovalsCount = pendingApprovalsResult.count ?? 0;

  const history: LeaveHistoryRow[] = (historyResult.data ?? [])
    .filter((r) => r.employees && r.leave_types)
    .map((r) => ({
      id: r.id,
      employeeId: r.employees!.id,
      employeeName: r.employees!.full_name,
      employeeCode: r.employees!.employee_code,
      department: r.employees!.department,
      office: r.employees!.office,
      leaveTypeCode: r.leave_types!.code,
      leaveTypeLabel: r.leave_types!.display_name,
      startDate: r.start_date,
      endDate: r.end_date,
      isHalfDay: r.is_half_day,
      halfDaySession: r.half_day_session,
      totalDays: r.total_days,
      status: r.status,
      isLwpOverride: r.is_lwp_override,
      appliedOn: r.applied_on,
      recordedBy: r.source === 'hr_manual' ? 'HR (manual entry)' : 'Employee self-service',
    }));

  const pendingRegularisations = regularisations.filter((r) => r.status !== 'approved').length;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <LeavePageHeader
        title="My Team"
        description="Live overview, roster balances, pending approvals, and team regularisations."
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        }
      />

      {reportsError && (
        <div className="bg-red-50 dark:bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-300 text-sm font-medium rounded-2xl px-4 py-3">
          Could not load your team: {reportsError.message}
        </div>
      )}

      {/* ── At-a-glance Metric Strip: 4 Key Team KPIs ────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Team members" value={reports.length} tone="neutral" />
        <StatCard
          label="On leave today"
          value={onLeaveToday.length}
          tone={onLeaveToday.length > 0 ? 'accent' : 'neutral'}
        />
        <StatCard
          label="Pending approvals"
          value={pendingApprovalsCount}
          tone={pendingApprovalsCount > 0 ? 'warn' : 'neutral'}
          href="/leave/approvals"
        />
        <StatCard
          label="Pending regularisations"
          value={pendingRegularisations}
          tone={pendingRegularisations > 0 ? 'warn' : 'neutral'}
        />
      </div>

      <TeamTabs
        onLeaveToday={onLeaveToday}
        regularisations={regularisations}
        reports={reports}
        balances={teamBalances}
        history={history}
      />
    </div>
  );
}

import Link from 'next/link';

function StatCard({
  label,
  value,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'accent' | 'warn';
  href?: string;
}) {
  const barColor = tone === 'accent' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-[var(--accent)]/40';
  const valueColor =
    tone === 'accent'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warn'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-[var(--text-primary)]';

  const content = (
    <div
      className={`relative rounded-2xl border border-[var(--border)] pl-6 pr-5 py-4 overflow-hidden transition-all duration-200 shadow-sm ${
        href ? 'hover:shadow-md hover:border-[var(--accent)]/40 hover:-translate-y-0.5 cursor-pointer' : ''
      }`}
      style={{
        background: 'linear-gradient(160deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
      }}
    >
      <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${barColor}`} aria-hidden />
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
        {href && (
          <span className="text-[10px] font-semibold text-[var(--accent)]">View →</span>
        )}
      </div>
      <p className={`text-3xl leading-none font-black mt-2 tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );

  if (href) {
    return <Link href={href} className="block">{content}</Link>;
  }
  return content;
}