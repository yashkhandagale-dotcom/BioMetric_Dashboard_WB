import { createLeaveClient } from '@/lib/leaveSupabase/server';
import AddEmployeeForm from './AddEmployeeForm';

export default async function EmployeesPage() {
  const supabase = await createLeaveClient();
  const { data: employees } = await supabase
    .from('employees')
    .select('id, employee_code, full_name, department, office, role, employment_status, date_of_joining')
    .order('full_name');

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Employees</h1>
        <a href="/leave/admin" className="text-xs text-slate-400 hover:text-white">← Back to balances</a>
      </div>

      <AddEmployeeForm />

      <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 text-xs border-b border-slate-700">
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Dept</th>
              <th className="px-4 py-3">Office</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">DOJ</th>
            </tr>
          </thead>
          <tbody>
            {(employees ?? []).map((e) => (
              <tr key={e.id} className="border-b border-slate-800 last:border-0">
                <td className="px-4 py-2.5 text-slate-300">{e.employee_code}</td>
                <td className="px-4 py-2.5">{e.full_name}</td>
                <td className="px-4 py-2.5 text-slate-400">{e.department}</td>
                <td className="px-4 py-2.5 text-slate-400">{e.office}</td>
                <td className="px-4 py-2.5 text-slate-400">{e.role}</td>
                <td className="px-4 py-2.5 text-slate-400">{e.employment_status}</td>
                <td className="px-4 py-2.5 text-slate-400">{e.date_of_joining}</td>
              </tr>
            ))}
            {(!employees || employees.length === 0) && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">No employees yet — add one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}