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
  fyStartYear: number = getFYStartYear(),
  employeeId?: string
): Promise<{ rows: EmployeeBalances[]; error: { message: string } | null }> {
  let query = supabase
    .from('leave_balances')
    .select(
      `
      employee_id,
      closing_balance,
      leave_types ( code ),
      employees ( full_name, employee_code, department, office )
    `
    )
    .eq('fy_start_year', fyStartYear);

  // Optional scope-down to a single employee — used by the Employee Modal's
  // profile route (Day 2) so it doesn't have to pull every employee's
  // balance rows just to show one person's SL/CL/PL/LWP figures. Existing
  // callers that omit this keep getting the full-roster pivot unchanged.
  if (employeeId) {
    query = query.eq('employee_id', employeeId);
  }

  const { data: balances, error } = await query.returns<BalanceRow[]>();

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

// ---------------------------------------------------------------------
// A3 — LeaveBalanceCards needs entitled/used/remaining per leave type,
// not just the closing_balance the pivot above exposes. Rather than
// having the component re-query leave_balances itself (a second,
// independently-drifting read of the same table this file already owns
// — see the header comment above), this is an additive export in the
// same file: same table, same fy_start_year/employee_id scoping, just
// selecting the columns that were already there
// (opening_balance/accrued/manual_adjustment/used) instead of only the
// generated closing_balance column. No new balance math — "entitled" is
// literally opening_balance + accrued + manual_adjustment, the exact
// terms the DB's own `closing_balance` generated column is defined from
// (see supabase-leave/schema.sql), just not summed away.
// ---------------------------------------------------------------------
export type LeaveBalanceBreakdown = {
  code: 'SL' | 'CL' | 'PL' | 'LWP';
  label: string;
  entitled: number;
  used: number;
  remaining: number;
};

type BreakdownRow = {
  opening_balance: number;
  accrued: number;
  used: number;
  manual_adjustment: number;
  closing_balance: number;
  leave_types: { code: string; display_name: string } | null;
};

export async function getEmployeeBalanceBreakdown(
  supabase: SupabaseClient,
  employeeId: string,
  fyStartYear: number = getFYStartYear()
): Promise<{ rows: LeaveBalanceBreakdown[]; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('leave_balances')
    .select('opening_balance, accrued, used, manual_adjustment, closing_balance, leave_types ( code, display_name )')
    .eq('employee_id', employeeId)
    .eq('fy_start_year', fyStartYear)
    .returns<BreakdownRow[]>();

  const rows = (data ?? [])
    .filter((r) => r.leave_types)
    .map((r) => ({
      code: r.leave_types!.code as 'SL' | 'CL' | 'PL' | 'LWP',
      label: r.leave_types!.display_name,
      entitled: r.opening_balance + r.accrued + r.manual_adjustment,
      used: r.used,
      remaining: r.closing_balance,
    }))
    .sort((a, b) => ['PL', 'CL', 'SL', 'LWP'].indexOf(a.code) - ['PL', 'CL', 'SL', 'LWP'].indexOf(b.code));

  return { rows, error: error ? { message: error.message } : null };
}