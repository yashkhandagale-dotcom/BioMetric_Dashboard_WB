import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getEmployeeBalancesByFY } from '@/lib/leaveSupabase/getEmployeeBalances';
import { getManagedEmployeeIds } from '@/lib/leaveSupabase/organization';
import { getEmployeesOnLeaveToday } from '@/lib/leaveSupabase/onLeaveToday';
import { listRegularisationsForEmployees } from '@/lib/leaveSupabase/regularisation';
import { selectAllRows } from '@/lib/attendanceExceptions';
import LeaveHistoryTable, { LeaveHistoryRow } from '@/components/leave/LeaveHistoryTable';
import LeavePageHeader from '@/components/leave/LeavePageHeader';
import RegulariseButton from '@/components/leave/RegulariseButton';

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
              employees ( id, full_name, employee_code, department, office ),
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

  // Feedback item #13 — "who's on leave today / pre-approved leave", and
  // item #2's regularisation history, both scoped to this manager/lead's
  // own team (teamIds), fetched alongside everything else this page
  // already loads server-side.
  const [{ rows: onLeaveToday }, { rows: regularisations }] = await Promise.all([
    teamIds.length > 0 ? getEmployeesOnLeaveToday(supabase, undefined, teamIds) : Promise.resolve({ rows: [], error: null }),
    teamIds.length > 0 ? listRegularisationsForEmployees(supabase, teamIds) : Promise.resolve({ rows: [], error: null }),
  ]);

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

  return (
    <div className="max-w-5xl space-y-6">
      <LeavePageHeader
        title="My Team"
        description="Balances and leave history for your team. View only — record leave and edits stay with HR."
      />

      {reportsError && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3 mb-4">
          Could not load your team: {reportsError.message}
        </div>
      )}

      {/* Feedback item #13 — plan/manage team workload at a glance. */}
      <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">On Leave Today ({onLeaveToday.length})</h2>
        {onLeaveToday.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">Nobody on your team is on approved leave today.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {onLeaveToday.map((row) => (
              <li key={`${row.employeeId}-${row.startDate}`} className="py-2 flex items-center justify-between text-sm">
                <div>
                  <p className="text-[var(--text-primary)]">{row.employeeName}</p>
                  <p className="text-[var(--text-muted)] text-xs">
                    {row.employeeCode} · {row.department}
                  </p>
                </div>
                <span className="text-xs font-medium rounded-full px-2 py-0.5 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                  {row.leaveTypeLabel}
                  {row.isHalfDay ? ` (${row.halfDaySession ?? 'Half day'})` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 mb-6">
          <h2 className="text-sm font-semibold mb-3">Roster &amp; Balances</h2>
          {!reports || reports.length === 0 ? (
            <p className="text-[var(--text-muted)] text-sm">No team members found for you yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] text-xs border-b border-[var(--border)]">
                    <th className="pb-2 pr-4">Employee</th>
                    <th className="pb-2 pr-4">Code</th>
                    <th className="pb-2 pr-4">Department</th>
                    <th className="pb-2 pr-4 text-right">SL</th>
                    <th className="pb-2 pr-4 text-right">CL</th>
                    <th className="pb-2 pr-4 text-right">PL</th>
                    <th className="pb-2 pr-4 text-right">LWP</th>
                    <th className="pb-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => {
                    const b = teamBalances.find((tb) => tb.employeeId === r.id);
                    return (
                      <tr key={r.id} className="border-b border-[var(--border)]/50 last:border-0">
                        <td className="py-2 pr-4">{r.full_name}</td>
                        <td className="py-2 pr-4 text-[var(--text-muted)]">{r.employee_code}</td>
                        <td className="py-2 pr-4 text-[var(--text-muted)]">{r.department}</td>
                        <td className="py-2 pr-4 text-right">{b ? b.SL.toFixed(1) : '—'}</td>
                        <td className="py-2 pr-4 text-right">{b ? b.CL.toFixed(1) : '—'}</td>
                        <td className="py-2 pr-4 text-right">{b ? b.PL.toFixed(1) : '—'}</td>
                        <td className="py-2 pr-4 text-right">{b ? b.LWP.toFixed(1) : '—'}</td>
                        <td className="py-2 text-right">
                          <RegulariseButton employeeId={r.id} employeeName={r.full_name} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* Feedback item #2 — manager-visible log of regularisations for their team. */}
      {regularisations.length > 0 && (
        <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Recent Regularisations</h2>
          <ul className="divide-y divide-[var(--border)]">
            {regularisations.slice(0, 20).map((row) => (
              <li key={row.id} className="py-2 text-sm">
                <p className="text-[var(--text-primary)]">
                  {row.employeeName} <span className="text-[var(--text-muted)] text-xs">({row.date})</span>
                </p>
                <p className="text-[var(--text-muted)] text-xs">{row.reason} — by {row.regularisedByName}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-3">Team Leave History</h2>
        <LeaveHistoryTable rows={history} />
      </div>
    </div>
  );
}
