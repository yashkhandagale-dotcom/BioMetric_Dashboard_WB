import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import SeedBalancesButton from './SeedBalancesButton';
import AdjustBalanceButton from './AdjustBalanceButton';

type BalanceRow = {
  employee_id: string;
  closing_balance: number;
  leave_types: { code: string } | null;
  employees: { full_name: string; employee_code: string; department: string; office: string } | null;
};

export default async function LeaveAdminHome() {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const fyStartYear = getFYStartYear();

  const { data: balances, error } = await supabase
    .from('leave_balances')
    .select(`
      employee_id,
      closing_balance,
      leave_types ( code ),
      employees ( full_name, employee_code, department, office )
    `)
    .eq('fy_start_year', fyStartYear)
    .returns<BalanceRow[]>();

  // Pivot: one row per employee, columns SL/CL/PL/LWP
  const byEmployee = new Map<
    string,
    { employeeId: string; name: string; code: string; department: string; office: string; SL: number; CL: number; PL: number; LWP: number }
  >();

  for (const row of balances ?? []) {
    if (!row.employees || !row.leave_types) continue;
    const key = row.employee_id;
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        employeeId: row.employee_id,
        name: row.employees.full_name,
        code: row.employees.employee_code,
        department: row.employees.department,
        office: row.employees.office,
        SL: 0, CL: 0, PL: 0, LWP: 0,
      });
    }
    const entry = byEmployee.get(key)!;
    const code = row.leave_types.code as 'SL' | 'CL' | 'PL' | 'LWP';
    entry[code] = row.closing_balance;
  }

  const rows = Array.from(byEmployee.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Leave Balances — {formatFYLabel(fyStartYear)}</h1>
          <p className="text-slate-500 text-xs mt-1">Signed in as {user?.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <SeedBalancesButton fyLabel={formatFYLabel(fyStartYear)} />
          <a
            href="/leave/admin/leave"
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Record Leave
          </a>
          <a
            href="/leave/admin/employees"
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Manage Employees
          </a>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {error.message}
        </div>
      )}

      <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 text-xs border-b border-slate-700">
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Dept</th>
              <th className="px-4 py-3">Office</th>
              <th className="px-4 py-3 text-right">Sick</th>
              <th className="px-4 py-3 text-right">Casual</th>
              <th className="px-4 py-3 text-right">Planned</th>
              <th className="px-4 py-3 text-right">LWP (taken)</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-b border-slate-800 last:border-0">
                <td className="px-4 py-2.5 text-slate-300">{r.code}</td>
                <td className="px-4 py-2.5">{r.name}</td>
                <td className="px-4 py-2.5 text-slate-400">{r.department}</td>
                <td className="px-4 py-2.5 text-slate-400">{r.office}</td>
                <td className="px-4 py-2.5 text-right">{r.SL.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right">{r.CL.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right">{r.PL.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right text-amber-400">{Math.abs(r.LWP).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right">
                  <AdjustBalanceButton employeeId={r.employeeId} employeeName={r.name} fyStartYear={fyStartYear} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                No employees yet. <a href="/leave/admin/employees" className="text-emerald-400 hover:underline">Add one</a> to see balances.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}