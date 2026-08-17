import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getEmployeeBalanceBreakdown } from '@/lib/leaveSupabase/getEmployeeBalances';
import { selectAllRows } from '@/lib/attendanceExceptions';
import MeNavbar from '@/components/leave/MeNavbar';
import PersonalAttendanceReport from '@/components/leave/PersonalAttendanceReport';
import LeaveBalanceCards from '@/components/leave/LeaveBalanceCards';
import LeaveHistoryTable, { LeaveHistoryRow } from '@/components/leave/LeaveHistoryTable';
import WfhPanel from '@/components/leave/WfhPanel';

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

// A6 — Server Component that assembles Part A: personal attendance
// report on the left, balance cards top-right, leave history
// full-width at the bottom, Apply for Leave button in the navbar
// (MeNavbar, the one client island on this page — see its own comment).
//
// History (A4) reuses LeaveHistoryTable.tsx directly, scoped to
// employee_id = the logged-in user, by querying leave_requests the
// exact same way app/api/leave/history/route.ts does — same table,
// same shape, same "recordedBy" derivation — rather than round-tripping
// through that route from a server component. All statuses
// (pending/approved/rejected/cancelled/auto_lwp) are included; there's
// no server-side status filter, LeaveHistoryTable renders whatever it's
// given and the Status column already color-codes each one.
export default async function LeaveMeHome() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    redirect('/leave/login');
  }

  const supabase = await createLeaveClient();

  const [{ rows: balances }, { data: historyRaw }] = await Promise.all([
    getEmployeeBalanceBreakdown(supabase, employee.id),
    selectAllRows<HistoryRow>((from, to) =>
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
        .eq('employee_id', employee.id)
        .order('start_date', { ascending: false })
        .range(from, to)
        .returns<HistoryRow[]>()
    ),
  ]);

  const history: LeaveHistoryRow[] = (historyRaw ?? [])
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
      recordedBy: r.source === 'hr_manual' ? 'HR (manual entry)' : 'Self-applied',
    }));

  return (
    <div className="max-w-6xl space-y-5">
      <MeNavbar
        employeeName={`${employee.full_name} · ${employee.employee_code} · ${employee.department}`}
        role={employee.role}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div className="lg:col-span-2">
          <PersonalAttendanceReport />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Leave Balances</h2>
          <LeaveBalanceCards balances={balances} />
        </div>
      </div>

      <WfhPanel />

      <div>
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">My Leave History</h2>
        <LeaveHistoryTable rows={history} showActions />
      </div>
    </div>
  );
}