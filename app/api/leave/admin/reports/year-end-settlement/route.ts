import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import { getEmployeeBalancesByFY } from '@/lib/leaveSupabase/getEmployeeBalances';

export async function GET(req: NextRequest) {
  try {
    const requester = await getCurrentEmployee();
    if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const fyParam = searchParams.get('fyStartYear');
    const fyStartYear = fyParam ? parseInt(fyParam, 10) : getFYStartYear();

    if (isNaN(fyStartYear) || fyStartYear < 2000 || fyStartYear > 2100) {
      return NextResponse.json({ error: 'Invalid fyStartYear parameter' }, { status: 400 });
    }

    const supabase = await createLeaveClient();
    const { rows, error: balanceError } = await getEmployeeBalancesByFY(supabase, fyStartYear);

    if (balanceError) {
      return NextResponse.json({ error: balanceError.message }, { status: 500 });
    }

    // Process pooled leave settlement calculation:
    // 1. Total Unused Pool = SL + CL + PL (all remaining leaves add up)
    // 2. First up to 7 days -> Carried Forward to next FY as opening PL
    // 3. Next up to 7 days (days 8-14) -> Encashed via Payroll payout
    // 4. Remainder (> 14 days) -> Lapsed / Trash
    const employees = (rows || []).map((emp) => {
      const sl = Math.max(0, Number((emp.SL ?? 0).toFixed(2)));
      const cl = Math.max(0, Number((emp.CL ?? 0).toFixed(2)));
      const pl = Math.max(0, Number((emp.PL ?? 0).toFixed(2)));
      const totalPool = Number((sl + cl + pl).toFixed(2));

      const carryForward = Number(Math.min(totalPool, 7).toFixed(2));
      const encashment = Number(Math.min(Math.max(totalPool - 7, 0), 7).toFixed(2));
      const lapsed = Number(Math.max(totalPool - 14, 0).toFixed(2));

      return {
        employeeId: emp.employeeId,
        name: emp.name,
        employeeCode: emp.code,
        department: emp.department || 'General',
        office: emp.office || 'Default',
        sl,
        cl,
        pl,
        totalPool,
        carryForward,
        encashment,
        lapsed,
        isEligibleForEncashment: encashment > 0,
      };
    });

    const summary = employees.reduce(
      (acc, emp) => {
        acc.totalEmployees += 1;
        acc.totalPoolLeaves = Number((acc.totalPoolLeaves + emp.totalPool).toFixed(2));
        acc.totalCarryForward = Number((acc.totalCarryForward + emp.carryForward).toFixed(2));
        acc.totalEncashment = Number((acc.totalEncashment + emp.encashment).toFixed(2));
        acc.totalLapsed = Number((acc.totalLapsed + emp.lapsed).toFixed(2));
        if (emp.isEligibleForEncashment) {
          acc.encashmentEligibleCount += 1;
        }
        return acc;
      },
      {
        totalEmployees: 0,
        totalPoolLeaves: 0,
        totalCarryForward: 0,
        totalEncashment: 0,
        totalLapsed: 0,
        encashmentEligibleCount: 0,
      }
    );

    return NextResponse.json({
      success: true,
      fyStartYear,
      fyLabel: formatFYLabel(fyStartYear),
      policyRule: 'Combined Pooled Leaves (SL+CL+PL): Max 7d Carry-Forward, Next 7d Encashment, Remainder Lapsed',
      summary,
      employees,
    });
  } catch (err: any) {
    console.error('Error calculating year-end settlement:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const requester = await getCurrentEmployee();
    if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { fyStartYear: inputFy, employeeIds } = body;
    const fyStartYear = inputFy ? parseInt(inputFy, 10) : getFYStartYear();

    if (isNaN(fyStartYear)) {
      return NextResponse.json({ error: 'Invalid fyStartYear' }, { status: 400 });
    }

    const supabase = await createLeaveClient();

    // Determine target employees
    let targetIds: string[] = [];
    if (Array.isArray(employeeIds) && employeeIds.length > 0) {
      targetIds = employeeIds;
    } else {
      const { rows } = await getEmployeeBalancesByFY(supabase, fyStartYear);
      targetIds = (rows || []).map((r) => r.employeeId);
    }

    const results: { employeeId: string; success: boolean; error?: string }[] = [];

    for (const empId of targetIds) {
      const { error: rpcError } = await supabase.rpc('fn_annual_leave_reset', {
        p_employee_id: empId,
        p_old_fy_start_year: fyStartYear,
      });

      if (rpcError) {
        results.push({ employeeId: empId, success: false, error: rpcError.message });
      } else {
        results.push({ employeeId: empId, success: true });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: true,
      message: `Annual rollover executed for FY ${formatFYLabel(fyStartYear)}: ${successCount} successful, ${failureCount} failed.`,
      successCount,
      failureCount,
      results,
    });
  } catch (err: any) {
    console.error('Error executing annual leave reset:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
