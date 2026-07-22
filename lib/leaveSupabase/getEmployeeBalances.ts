import type { SupabaseClient } from '@supabase/supabase-js';
import { getFYStartYear } from './fyHelpers';

// Single source of truth for "pivot leave_balances into one row per
// employee with SL/CL/PL/LWP columns". Extracted from
// app/leave/admin/page.tsx so the Employee Overview grid (Day 1) can show
// the exact same live balances without a second, independently-drifting
// implementation of this pivot. Do not re-derive this inline elsewhere —
// import and reuse.

export type EmployeeBalances = {
  employeeId: string;
  name: string;
  code: string;
  department: string;
  office: string;
  SL: number;
  CL: number;
  PL: number;
  LWP: number;
};

type BalanceRow = {
  employee_id: string;
  closing_balance: number;
  leave_types: { code: string } | null;
  employees: { full_name: string; employee_code: string; department: string; office: string } | null;
};

export async function getEmployeeBalancesByFY(
  supabase: SupabaseClient,
  fyStartYear: number = getFYStartYear()
): Promise<{ rows: EmployeeBalances[]; error: { message: string } | null }> {
  const { data: balances, error } = await supabase
    .from('leave_balances')
    .select(
      `
      employee_id,
      closing_balance,
      leave_types ( code ),
      employees ( full_name, employee_code, department, office )
    `
    )
    .eq('fy_start_year', fyStartYear)
    .returns<BalanceRow[]>();

  // Pivot: one row per employee, columns SL/CL/PL/LWP
  const byEmployee = new Map<string, EmployeeBalances>();

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
        SL: 0,
        CL: 0,
        PL: 0,
        LWP: 0,
      });
    }
    const entry = byEmployee.get(key)!;
    const code = row.leave_types.code as 'SL' | 'CL' | 'PL' | 'LWP';
    entry[code] = row.closing_balance;
  }

  return {
    rows: Array.from(byEmployee.values()).sort((a, b) => a.name.localeCompare(b.name)),
    error: error ? { message: error.message } : null,
  };
}