import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear } from '@/lib/leaveSupabase/fyHelpers';
import { getEmployeeBalancesByFY } from '@/lib/leaveSupabase/getEmployeeBalances';
import AddEmployeeForm from './AddEmployeeForm';
import EmployeeGrid from '@/components/leave/EmployeeGrid';
import type { EmployeeWithBalances } from '@/components/leave/EmployeeCard';

export default async function EmployeesPage() {
  const supabase = await createLeaveClient();
  const fyStartYear = getFYStartYear();

  // Employee roster and balances are two separate queries (different
  // tables), fetched in parallel and merged below. Balances come from the
  // shared getEmployeeBalancesByFY helper — the same one app/leave/admin
  // uses — so figures here can never drift from what that page shows.
  const [{ data: employees, error: employeesError }, { rows: balances, error: balancesError }] = await Promise.all([
    supabase
      .from('employees')
      .select('id, employee_code, full_name, department, office, role, employment_status, date_of_joining')
      .order('full_name'),
    getEmployeeBalancesByFY(supabase, fyStartYear),
  ]);

  const balancesById = new Map(balances.map((b) => [b.employeeId, b]));

  const merged: EmployeeWithBalances[] = (employees ?? []).map((e) => {
    const b = balancesById.get(e.id);
    return {
      id: e.id,
      code: e.employee_code,
      name: e.full_name,
      department: e.department,
      office: e.office,
      role: e.role,
      employmentStatus: e.employment_status,
      dateOfJoining: e.date_of_joining,
      SL: b?.SL ?? 0,
      CL: b?.CL ?? 0,
      PL: b?.PL ?? 0,
      LWP: b?.LWP ?? 0,
    };
  });

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Employees</h1>
        <div className="flex items-center gap-4">
          <a href="/leave/admin/history" className="text-xs text-slate-400 hover:text-white">Leave History →</a>
          <a href="/leave/admin/violations" className="text-xs text-red-400 hover:text-red-300">Violations →</a>
          <a href="/leave/admin" className="text-xs text-slate-400 hover:text-white">← Back to balances</a>
        </div>
      </div>

      <AddEmployeeForm />

      {(employeesError || balancesError) && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {employeesError?.message || balancesError?.message}
        </div>
      )}

      <EmployeeGrid employees={merged} fyStartYear={fyStartYear} />
    </div>
  );
}