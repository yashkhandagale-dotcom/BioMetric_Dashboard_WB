import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { selectAllRows } from '@/lib/attendanceExceptions';
import { requireHrAccess } from '@/lib/leaveSupabase/leaveAnalytics/auth';
import { parseAnalyticsFilters } from '@/lib/leaveSupabase/leaveAnalytics/filters';

interface BalanceByTypeAndDept {
  leaveTypeCode: string;
  leaveTypeName: string;
  department: string;
  allocatedDays: number;
  usedDays: number;
  unusedDays: number;
  utilizationPercent: number;
  employeeCount: number;
}

interface RankedBalanceRecord {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  leaveTypeCode: string;
  closingBalance: number;
  allocatedDays: number;
  usedDays: number;
}

interface LedgerReasonSummary {
  reason: string;
  label: string;
  transactionCount: number;
  totalDeltaDays: number;
}

const REASON_LABELS: Record<string, string> = {
  lapse: 'Year-End Lapse / Forfeiture',
  encashment: 'Leave Encashment',
  carry_forward: 'Carried Forward from Prior FY',
  hr_manual_adjustment: 'HR Manual Adjustment',
  leave_approved: 'Approved Leave Debit',
  leave_cancelled: 'Cancelled Leave Credit',
  leave_credited: 'Annual Quota Credit',
  comp_off_credited: 'Comp-Off Credit',
};

export async function GET(req: NextRequest) {
  const auth = await requireHrAccess();
  if (!auth.authorized) return auth.response;

  const parsed = parseAnalyticsFilters(req.nextUrl.searchParams);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { filters } = parsed;
  const supabase = await createLeaveClient();

  try {
    // 1. Fetch non-deleted employees
    const { data: allEmployees, error: empErr } = await selectAllRows<any>((from, to) =>
      (supabase
        .from('employees')
        .select('id, full_name, employee_code, department, office, employment_status, is_deleted')
        .eq('is_deleted', false) as any)
        .range(from, to)
    );

    if (empErr) {
      return NextResponse.json({ error: `Failed to load employees: ${empErr.message}` }, { status: 500 });
    }

    const filteredEmployees = (allEmployees ?? []).filter((e) => {
      if (filters.office && e.office?.toUpperCase() !== filters.office) return false;
      if (filters.department && e.department?.toLowerCase() !== filters.department.toLowerCase()) return false;
      return true;
    });

    const allowedEmpIds = new Set(filteredEmployees.map((e) => e.id));

    // 2. Fetch leave balances for current FY
    const { data: balances, error: balErr } = await selectAllRows<any>((from, to) =>
      (supabase
        .from('leave_balances')
        .select(
          `
          id, employee_id, leave_type_id, opening_balance, accrued, used, manual_adjustment, closing_balance,
          leave_types ( code, display_name ),
          employees!leave_balances_employee_id_fkey ( id, full_name, employee_code, department, office, employment_status, is_deleted )
        `
        )
        .eq('fy_start_year', filters.fyStartYear) as any)
        .range(from, to)
    );

    if (balErr) {
      return NextResponse.json({ error: `Failed to load balances: ${balErr.message}` }, { status: 500 });
    }

    const validBalances = (balances ?? []).filter((b: any) => allowedEmpIds.has(b.employee_id));
    const balanceIds = new Set(validBalances.map((b: any) => b.id));

    // 3. Aggregate balances per leave type & department
    const groupMap = new Map<
      string,
      {
        leaveTypeCode: string;
        leaveTypeName: string;
        department: string;
        allocated: number;
        used: number;
        unused: number;
        empCount: number;
      }
    >();

    const rankedRecords: RankedBalanceRecord[] = [];

    for (const b of validBalances) {
      const emp = Array.isArray(b.employees) ? b.employees[0] : b.employees;
      const lt = Array.isArray(b.leave_types) ? b.leave_types[0] : b.leave_types;
      const code = lt?.code?.toUpperCase() || 'UNKNOWN';
      const name = lt?.display_name || code;
      const dept = emp?.department || 'General';
      const office = emp?.office || 'MUM';

      const allocated = (b.opening_balance || 0) + (b.accrued || 0) + (b.manual_adjustment || 0);
      const used = b.used || 0;
      const unused = b.closing_balance || 0;

      // Group key: `${code}__${dept}`
      const key = `${code}__${dept}`;
      const existing = groupMap.get(key) || {
        leaveTypeCode: code,
        leaveTypeName: name,
        department: dept,
        allocated: 0,
        used: 0,
        unused: 0,
        empCount: 0,
      };

      existing.allocated += allocated;
      existing.used += used;
      existing.unused += unused;
      existing.empCount += 1;
      groupMap.set(key, existing);

      // Collect for top/bottom ranking (SL, CL, PL only)
      if (code !== 'LWP') {
        rankedRecords.push({
          employeeId: emp.id,
          employeeName: emp.full_name,
          employeeCode: emp.employee_code,
          department: dept,
          office,
          leaveTypeCode: code,
          closingBalance: Math.round(unused * 10) / 10,
          allocatedDays: Math.round(allocated * 10) / 10,
          usedDays: Math.round(used * 10) / 10,
        });
      }
    }

    const byTypeAndDepartment: BalanceByTypeAndDept[] = Array.from(groupMap.values())
      .map((g) => ({
        leaveTypeCode: g.leaveTypeCode,
        leaveTypeName: g.leaveTypeName,
        department: g.department,
        allocatedDays: Math.round(g.allocated * 10) / 10,
        usedDays: Math.round(g.used * 10) / 10,
        unusedDays: Math.round(g.unused * 10) / 10,
        utilizationPercent:
          g.allocated > 0 ? Math.round((g.used / g.allocated) * 1000) / 10 : 0,
        employeeCount: g.empCount,
      }))
      .sort((a, b) => {
        if (a.leaveTypeCode !== b.leaveTypeCode) {
          return a.leaveTypeCode.localeCompare(b.leaveTypeCode);
        }
        return b.allocatedDays - a.allocatedDays;
      });

    // Top 10 highest balances
    const top10Highest = [...rankedRecords]
      .sort((a, b) => b.closingBalance - a.closingBalance)
      .slice(0, 10);

    // Top 10 lowest balances
    const top10Lowest = [...rankedRecords]
      .sort((a, b) => a.closingBalance - b.closingBalance)
      .slice(0, 10);

    // 4. Balance transactions ledger summary for the FY
    // Fetch balance transactions for balances in this FY
    const { data: transactions, error: txErr } = await selectAllRows<any>((from, to) =>
      (supabase
        .from('balance_transactions')
        .select('id, leave_balance_id, delta, reason')
        .range(from, to) as any)
    );

    if (txErr) {
      console.warn('Balance transactions fetch error:', txErr.message);
    }

    const relevantTx = (transactions ?? []).filter((t: any) => balanceIds.has(t.leave_balance_id));

    const ledgerMap = new Map<string, { count: number; deltaSum: number }>();
    for (const tx of relevantTx) {
      const reason = tx.reason || 'other';
      const existing = ledgerMap.get(reason) || { count: 0, deltaSum: 0 };
      existing.count += 1;
      existing.deltaSum += Number(tx.delta) || 0;
      ledgerMap.set(reason, existing);
    }

    // Ensure core required ledger reasons are present
    const coreReasons = ['lapse', 'encashment', 'carry_forward', 'hr_manual_adjustment'];
    for (const cr of coreReasons) {
      if (!ledgerMap.has(cr)) {
        ledgerMap.set(cr, { count: 0, deltaSum: 0 });
      }
    }

    const ledgerSummary: LedgerReasonSummary[] = Array.from(ledgerMap.entries())
      .map(([reason, data]) => ({
        reason,
        label: REASON_LABELS[reason] || reason.replace(/_/g, ' '),
        transactionCount: data.count,
        totalDeltaDays: Math.round(data.deltaSum * 10) / 10,
      }))
      .sort((a, b) => Math.abs(b.totalDeltaDays) - Math.abs(a.totalDeltaDays));

    return NextResponse.json({
      fyStartYear: filters.fyStartYear,
      byTypeAndDepartment,
      top10Highest,
      top10Lowest,
      ledgerSummary,
      liabilityNotice:
        'Days only: no monetary/salary data exists in this system; financial balance sheet liability is not computed.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown server error';
    console.error('Balances analytics error:', err);
    return NextResponse.json({ error: `Failed to compute balance analytics: ${msg}` }, { status: 500 });
  }
}
