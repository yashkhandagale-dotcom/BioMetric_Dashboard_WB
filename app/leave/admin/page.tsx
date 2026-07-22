import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import { getEmployeeBalancesByFY } from '@/lib/leaveSupabase/getEmployeeBalances';
import SeedBalancesButton from './SeedBalancesButton';
import AdjustBalanceButton from './AdjustBalanceButton';

export default async function LeaveAdminHome() {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const fyStartYear = getFYStartYear();

  // Pivot logic (one row per employee, SL/CL/PL/LWP columns) now lives in
  // lib/leaveSupabase/getEmployeeBalances.ts, shared with the Employee
  // Overview grid (app/leave/admin/employees) so the two pages can never
  // show different numbers for the same employee.
  const { rows, error } = await getEmployeeBalancesByFY(supabase, fyStartYear);

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