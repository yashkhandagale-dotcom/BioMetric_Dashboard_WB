import type { SupabaseClient } from '@supabase/supabase-js';
import { getFYStartYear } from './fyHelpers';

// Single source of truth for "pivot leave_balances into one row per
// employee with SL/CL/PL/LWP columns".
//
// SL / CL / PL are balance-based and come from leave_balances.
//
// LWP is NOT balance-based in this system. LWP usage is calculated
// directly from approved leave_requests because LWP does not have
// a leave_balances row.

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
  leave_types: { code: string }[] | { code: string } | null;
  employees: {
    full_name: string;
    employee_code: string;
    department: string;
    office: string;
  } | null;
};

type LwpRequestRow = {
  total_days: number | null;
  leave_types:
    | { code: string }[]
    | { code: string }
    | null;
};

function getLeaveTypeCode(
  leaveTypes: BalanceRow['leave_types']
): string | null {
  if (!leaveTypes) return null;

  if (Array.isArray(leaveTypes)) {
    return leaveTypes[0]?.code ?? null;
  }

  return leaveTypes.code;
}

function getLwpLeaveTypeCode(
  leaveTypes: LwpRequestRow['leave_types']
): string | null {
  if (!leaveTypes) return null;

  if (Array.isArray(leaveTypes)) {
    return leaveTypes[0]?.code ?? null;
  }

  return leaveTypes.code;
}

// ---------------------------------------------------------------------
// Employee Overview
//
// SL / CL / PL come from leave_balances.
// LWP is calculated from approved leave_requests.
// ---------------------------------------------------------------------

export async function getEmployeeBalancesByFY(
  supabase: SupabaseClient,
  fyStartYear: number = getFYStartYear(),
  employeeId?: string
): Promise<{
  rows: EmployeeBalances[];
  error: { message: string } | null;
}> {
  let query = supabase
    .from('leave_balances')
    .select(
      `
      employee_id,
      closing_balance,
      leave_types ( code ),
      employees (
        full_name,
        employee_code,
        department,
        office
      )
    `
    )
    .eq('fy_start_year', fyStartYear);

  if (employeeId) {
    query = query.eq('employee_id', employeeId);
  }

  const { data: balances, error } =
    await query.returns<BalanceRow[]>();

  if (error) {
    return {
      rows: [],
      error: { message: error.message },
    };
  }

  // ---------------------------------------------------------------
  // First build the employee map from leave_balances.
  // ---------------------------------------------------------------

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
    const code = getLeaveTypeCode(row.leave_types);

    if (
      code === 'SL' ||
      code === 'CL' ||
      code === 'PL' ||
      code === 'LWP'
    ) {
      entry[code] = Number(row.closing_balance ?? 0);
    }
  }

  // ---------------------------------------------------------------
  // LWP does not use leave_balances.
  //
  // Calculate approved LWP directly from leave_requests.
  // ---------------------------------------------------------------

  let lwpQuery = supabase
    .from('leave_requests')
    .select(
      `
      employee_id,
      total_days,
      leave_types!inner (
        code
      )
    `
    )
    .eq('status', 'approved')
    .eq('leave_types.code', 'LWP');

  if (employeeId) {
    lwpQuery = lwpQuery.eq('employee_id', employeeId);
  }

  const { data: lwpRequests, error: lwpError } =
    await lwpQuery.returns<
      (LwpRequestRow & { employee_id: string })[]
    >();

  if (lwpError) {
    return {
      rows: [],
      error: { message: lwpError.message },
    };
  }

  // Sum LWP per employee.
  const lwpByEmployee = new Map<string, number>();

  for (const request of lwpRequests ?? []) {
    const employeeKey = request.employee_id;

    const days = Number(request.total_days ?? 0);

    if (!lwpByEmployee.has(employeeKey)) {
      lwpByEmployee.set(employeeKey, 0);
    }

    lwpByEmployee.set(
      employeeKey,
      lwpByEmployee.get(employeeKey)! + days
    );
  }

  // Apply calculated LWP to existing employee rows.
  for (const [employeeKey, lwpDays] of lwpByEmployee) {
    const entry = byEmployee.get(employeeKey);

    if (entry) {
      entry.LWP = lwpDays;
    }
  }

  return {
    rows: Array.from(byEmployee.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
    error: null,
  };
}

// ---------------------------------------------------------------------
// A3 — Leave Balance Cards
//
// SL / CL / PL:
//   entitled = opening + accrued + manual adjustment
//   used      = leave_balances.used
//   remaining = leave_balances.closing_balance
//
// LWP:
//   entitled = 0
//   used      = SUM(approved leave_requests.total_days)
//   remaining = 0
//
// LWP intentionally does NOT require a leave_balances row.
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
  leave_types:
    | {
        code: string;
        display_name: string;
      }[]
    | {
        code: string;
        display_name: string;
      }
    | null;
};

function getBreakdownLeaveType(
  leaveTypes: BreakdownRow['leave_types']
): {
  code: string;
  display_name: string;
} | null {
  if (!leaveTypes) return null;

  if (Array.isArray(leaveTypes)) {
    return leaveTypes[0] ?? null;
  }

  return leaveTypes;
}

export async function getEmployeeBalanceBreakdown(
  supabase: SupabaseClient,
  employeeId: string,
  fyStartYear: number = getFYStartYear()
): Promise<{
  rows: LeaveBalanceBreakdown[];
  error: { message: string } | null;
}> {
  // ---------------------------------------------------------------
  // Normal balance-based leaves: SL / CL / PL
  // ---------------------------------------------------------------

  const { data, error } = await supabase
    .from('leave_balances')
    .select(
      `
      opening_balance,
      accrued,
      used,
      manual_adjustment,
      closing_balance,
      leave_types (
        code,
        display_name
      )
    `
    )
    .eq('employee_id', employeeId)
    .eq('fy_start_year', fyStartYear)
    .returns<BreakdownRow[]>();

  if (error) {
    return {
      rows: [],
      error: { message: error.message },
    };
  }

  const rows: LeaveBalanceBreakdown[] = [];

  for (const r of data ?? []) {
    const leaveType = getBreakdownLeaveType(r.leave_types);

    if (!leaveType) continue;

    const code = leaveType.code as
      | 'SL'
      | 'CL'
      | 'PL'
      | 'LWP';

    // LWP is handled separately below.
    if (code === 'LWP') continue;

    rows.push({
      code,
      label: leaveType.display_name,
      entitled:
        Number(r.opening_balance ?? 0) +
        Number(r.accrued ?? 0) +
        Number(r.manual_adjustment ?? 0),
      used: Number(r.used ?? 0),
      remaining: Number(r.closing_balance ?? 0),
    });
  }

  // ---------------------------------------------------------------
  // LWP
  //
  // Do NOT look for an LWP balance row.
  // Read approved LWP directly from leave_requests.
  // ---------------------------------------------------------------

  const { data: lwpRequests, error: lwpError } =
    await supabase
      .from('leave_requests')
      .select(
        `
        total_days,
        leave_types!inner (
          code
        )
      `
      )
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .eq('leave_types.code', 'LWP')
      .returns<LwpRequestRow[]>();

  if (lwpError) {
    return {
      rows: [],
      error: { message: lwpError.message },
    };
  }

  const lwpUsed = (lwpRequests ?? []).reduce(
    (total, request) =>
      total + Number(request.total_days ?? 0),
    0
  );

  // Only show an LWP row when the employee has actually used LWP.
  if (lwpUsed > 0) {
    rows.push({
      code: 'LWP',
      label: 'Leave Without Pay',
      entitled: 0,
      used: lwpUsed,
      remaining: 0,
    });
  }

  // Keep the original ordering.
  rows.sort(
    (a, b) =>
      ['PL', 'CL', 'SL', 'LWP'].indexOf(a.code) -
      ['PL', 'CL', 'SL', 'LWP'].indexOf(b.code)
  );

  return {
    rows,
    error: null,
  };
}