import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getAttendanceExceptionsRange } from '@/lib/attendanceExceptions';
import { getEmployeeBalancesByFY } from '@/lib/leaveSupabase/getEmployeeBalances';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

interface UnmarkedItem {
  date: string;
  kind: 'absent' | 'half_day';
  detail: string;
  firstPunch?: string | null;
  lastPunch?: string | null;
  dayCount: number;
}

interface GroupedUnmarkedEmployee {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  office: string;
  balances: {
    sl: number;
    cl: number;
    pl: number;
    totalPaid: number;
  };
  unmarkedItems: UnmarkedItem[];
  totalUnmarkedDays: number;
  canCoverWithPaidBalance: boolean;
}

export async function GET(req: NextRequest) {
  try {
    const requester = await getCurrentEmployee();
    if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const now = new Date();
    const year = parseInt(searchParams.get('year') ?? String(now.getUTCFullYear()), 10);
    const month = parseInt(searchParams.get('month') ?? String(now.getUTCMonth() + 1), 10);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Valid year and month (1-12) are required' }, { status: 400 });
    }

    // Leave cycle window: 25th of month M-1 to 24th of month M
    const lwpStartDate = new Date(Date.UTC(year, month - 2, 25));
    const lwpWindowStart = lwpStartDate.toISOString().slice(0, 10);
    const lwpEndDate = new Date(Date.UTC(year, month - 1, 24));
    const lwpWindowEnd = lwpEndDate.toISOString().slice(0, 10);

    const supabase = await createLeaveClient();

    // 1. Fetch biometric attendance exceptions (absentees & half days) in this cycle
    const { absentees, halfDayCandidates } = await getAttendanceExceptionsRange(
      supabase,
      lwpWindowStart,
      lwpWindowEnd
    );

    // 2. Fetch employee balances for current FY
    const fyStartYear = getFYStartYear(new Date(year, month - 1, 15));
    const { rows: balanceRows } = await getEmployeeBalancesByFY(supabase, fyStartYear);
    const balanceMap = new Map<string, { sl: number; cl: number; pl: number; totalPaid: number }>();
    for (const b of balanceRows ?? []) {
      const sl = Number((b.SL ?? 0).toFixed(2));
      const cl = Number((b.CL ?? 0).toFixed(2));
      const pl = Number((b.PL ?? 0).toFixed(2));
      balanceMap.set(b.employeeId, {
        sl,
        cl,
        pl,
        totalPaid: Number((sl + cl + pl).toFixed(2)),
      });
    }

    // 3. Group by employee
    const employeeMap = new Map<string, GroupedUnmarkedEmployee>();

    // Process full-day absentees
    for (const a of absentees ?? []) {
      if (!employeeMap.has(a.employeeId)) {
        const bal = balanceMap.get(a.employeeId) ?? { sl: 0, cl: 0, pl: 0, totalPaid: 0 };
        employeeMap.set(a.employeeId, {
          employeeId: a.employeeId,
          name: a.employeeName,
          employeeCode: a.employeeCode,
          department: a.department || 'General',
          office: a.office || 'WonderBiz',
          balances: bal,
          unmarkedItems: [],
          totalUnmarkedDays: 0,
          canCoverWithPaidBalance: false,
        });
      }
      const entry = employeeMap.get(a.employeeId)!;
      entry.unmarkedItems.push({
        date: a.date,
        kind: 'absent',
        detail: 'Full day absent (no punches recorded)',
        dayCount: 1.0,
      });
      entry.totalUnmarkedDays = Number((entry.totalUnmarkedDays + 1.0).toFixed(2));
    }

    // Process half-day candidates
    for (const h of halfDayCandidates ?? []) {
      if (!employeeMap.has(h.employeeId)) {
        const bal = balanceMap.get(h.employeeId) ?? { sl: 0, cl: 0, pl: 0, totalPaid: 0 };
        employeeMap.set(h.employeeId, {
          employeeId: h.employeeId,
          name: h.employeeName,
          employeeCode: h.employeeCode,
          department: h.department || 'General',
          office: h.office || 'WonderBiz',
          balances: bal,
          unmarkedItems: [],
          totalUnmarkedDays: 0,
          canCoverWithPaidBalance: false,
        });
      }
      const entry = employeeMap.get(h.employeeId)!;
      entry.unmarkedItems.push({
        date: h.date,
        kind: 'half_day',
        detail: h.reason || 'Under 5 hours worked / single punch',
        firstPunch: h.firstPunch,
        lastPunch: h.lastPunch,
        dayCount: 0.5,
      });
      entry.totalUnmarkedDays = Number((entry.totalUnmarkedDays + 0.5).toFixed(2));
    }

    // Calculate canCoverWithPaidBalance and sort items by date
    const employees = Array.from(employeeMap.values()).map((emp) => {
      emp.unmarkedItems.sort((x, y) => x.date.localeCompare(y.date));
      emp.canCoverWithPaidBalance = emp.balances.totalPaid >= emp.totalUnmarkedDays;
      return emp;
    }).sort((a, b) => b.totalUnmarkedDays - a.totalUnmarkedDays || a.name.localeCompare(b.name));

    const totalUnmarkedDays = employees.reduce((sum, e) => sum + e.totalUnmarkedDays, 0);
    const staffWithSufficientBalanceCount = employees.filter((e) => e.canCoverWithPaidBalance).length;
    const staffWithZeroBalanceCount = employees.filter((e) => e.balances.totalPaid === 0).length;

    return NextResponse.json({
      success: true,
      year,
      month,
      monthLabel: `${MONTH_NAMES[month - 1]} ${year}`,
      fyLabel: formatFYLabel(fyStartYear),
      lwpWindow: { start: lwpWindowStart, end: lwpWindowEnd },
      summary: {
        totalStaffCount: employees.length,
        totalUnmarkedDays: Number(totalUnmarkedDays.toFixed(2)),
        staffWithSufficientBalanceCount,
        staffWithZeroBalanceCount,
      },
      employees,
    });
  } catch (err: any) {
    console.error('Error fetching unmarked absences report:', err);
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
    const { year, month, employeeId, remindAll } = body;

    if (!year || !month) {
      return NextResponse.json({ error: 'year and month are required' }, { status: 400 });
    }

    const lwpStartDate = new Date(Date.UTC(year, month - 2, 25));
    const lwpWindowStart = lwpStartDate.toISOString().slice(0, 10);
    const lwpEndDate = new Date(Date.UTC(year, month - 1, 24));
    const lwpWindowEnd = lwpEndDate.toISOString().slice(0, 10);
    const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

    const supabase = await createLeaveClient();

    // 1. Fetch unmarked absences in cycle
    const { absentees, halfDayCandidates } = await getAttendanceExceptionsRange(
      supabase,
      lwpWindowStart,
      lwpWindowEnd
    );

    // 2. Fetch balances
    const fyStartYear = getFYStartYear(new Date(year, month - 1, 15));
    const { rows: balanceRows } = await getEmployeeBalancesByFY(supabase, fyStartYear);
    const balanceMap = new Map<string, { sl: number; cl: number; pl: number; totalPaid: number }>();
    for (const b of balanceRows ?? []) {
      const sl = Number((b.SL ?? 0).toFixed(2));
      const cl = Number((b.CL ?? 0).toFixed(2));
      const pl = Number((b.PL ?? 0).toFixed(2));
      balanceMap.set(b.employeeId, { sl, cl, pl, totalPaid: Number((sl + cl + pl).toFixed(2)) });
    }

    // 3. Group by employee
    const employeeItems = new Map<string, { name: string; items: { date: string; type: string }[] }>();

    for (const a of absentees ?? []) {
      if (!employeeItems.has(a.employeeId)) {
        employeeItems.set(a.employeeId, { name: a.employeeName, items: [] });
      }
      employeeItems.get(a.employeeId)!.items.push({ date: a.date, type: 'Full Day Absent' });
    }

    for (const h of halfDayCandidates ?? []) {
      if (!employeeItems.has(h.employeeId)) {
        employeeItems.set(h.employeeId, { name: h.employeeName, items: [] });
      }
      employeeItems.get(h.employeeId)!.items.push({ date: h.date, type: 'Half Day (< 5h)' });
    }

    // 4. Determine target employees
    const targetEmployeeIds: string[] = [];
    if (remindAll) {
      targetEmployeeIds.push(...Array.from(employeeItems.keys()));
    } else if (employeeId && employeeItems.has(employeeId)) {
      targetEmployeeIds.push(employeeId);
    } else {
      return NextResponse.json({ error: 'No matching employee found with unmarked absences' }, { status: 400 });
    }

    if (targetEmployeeIds.length === 0) {
      return NextResponse.json({ success: true, message: 'No unmarked absences found to remind.', remindedCount: 0 });
    }

    const notificationsToInsert: any[] = [];

    for (const empId of targetEmployeeIds) {
      const data = employeeItems.get(empId);
      if (!data) continue;

      const balances = balanceMap.get(empId) ?? { sl: 0, cl: 0, pl: 0, totalPaid: 0 };
      const dateListStr = data.items.map((i) => `• ${i.date} (${i.type})`).join('\n');

      const title = `Action Required: ${data.items.length} Unmarked Absence(s) for ${monthLabel} Payroll`;
      const bodyText =
        `Dear ${data.name},\n\n` +
        `Our biometric attendance logs indicate unmarked absence(s) for the ${monthLabel} payroll cycle (${lwpWindowStart} to ${lwpWindowEnd}):\n\n` +
        `${dateListStr}\n\n` +
        `Your Available Paid Balance:\n` +
        `• Sick Leave (SL): ${balances.sl} days\n` +
        `• Casual Leave (CL): ${balances.cl} days\n` +
        `• Privilege Leave (PL): ${balances.pl} days\n` +
        `Total Paid Leave Available: ${balances.totalPaid} days.\n\n` +
        `IMPORTANT: Please submit your leave application or attendance regularisation in the portal before the 24th payroll cutoff.\n` +
        `Any unapproved or unregularized dates will be processed as Leave Without Pay (LWP) and deducted from your 30 paid days.`;

      notificationsToInsert.push({
        recipient_employee_id: empId,
        type: 'leave_reminder',
        title,
        body: bodyText,
        created_at: new Date().toISOString(),
      });
    }

    if (notificationsToInsert.length > 0) {
      const { error: notifErr } = await supabase.from('notifications').insert(notificationsToInsert);
      if (notifErr) {
        return NextResponse.json({ error: notifErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      remindedCount: notificationsToInsert.length,
      message: `Successfully sent reminders to ${notificationsToInsert.length} employee(s) with their unmarked dates and available leave balances.`,
    });
  } catch (err: any) {
    console.error('Error sending unmarked absences reminder:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

