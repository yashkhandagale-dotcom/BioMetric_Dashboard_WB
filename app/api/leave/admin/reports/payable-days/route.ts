import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getLwpDaysForEmployees } from '@/lib/leaveSupabase/lwpDayCount';
import { getAttendanceExceptionsRange } from '@/lib/attendanceExceptions';
import { getEmployeeBalancesByFY } from '@/lib/leaveSupabase/getEmployeeBalances';
import { getFYStartYear } from '@/lib/leaveSupabase/fyHelpers';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

interface EmployeeRow {
  id: string;
  employee_code: string;
  full_name: string;
  department: string | null;
  office: string | null;
  employment_status: string;
  date_of_joining: string | null;
  date_of_exit: string | null;
  is_deleted: boolean;
}

export async function GET(req: NextRequest) {
  return handleReport(req);
}

export async function POST(req: NextRequest) {
  return handleReport(req);
}

async function handleReport(req: NextRequest) {
  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  let year: number;
  let month: number; // 1-12
  let clampNewJoiners = false; // default: full month (spec requirement)
  let excludeExited = true;     // default: exclude exited/F&F employees
  const searchParams = req.nextUrl.searchParams;

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      year = Number(body.year);
      month = Number(body.month);
      if (typeof body.clampNewJoiners === 'boolean') clampNewJoiners = body.clampNewJoiners;
      if (typeof body.excludeExited === 'boolean') excludeExited = body.excludeExited;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }
  } else {
    const now = new Date();
    year = Number(searchParams.get('year') ?? now.getUTCFullYear());
    month = Number(searchParams.get('month') ?? now.getUTCMonth() + 1);
    if (searchParams.has('clampNewJoiners')) {
      clampNewJoiners = searchParams.get('clampNewJoiners') === 'true';
    }
    if (searchParams.has('excludeExited')) {
      excludeExited = searchParams.get('excludeExited') !== 'false';
    }
  }

  if (isNaN(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Valid year is required (e.g. 2026).' }, { status: 400 });
  }
  if (isNaN(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Valid month is required (1 to 12).' }, { status: 400 });
  }

  // Universal Indian Payroll Standard: all months are computed on a fixed 30-day base
  const STANDARD_MONTH_BASE = 30;

  // Days in calendar month M (kept for reference and calendar boundary filtering)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthStartISO = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEndISO = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  // LWP window: fixed [25th of month M-1, 24th of month M]
  const lwpStartDate = new Date(Date.UTC(year, month - 2, 25));
  const lwpWindowStart = lwpStartDate.toISOString().slice(0, 10);
  const lwpEndDate = new Date(Date.UTC(year, month - 1, 24));
  const lwpWindowEnd = lwpEndDate.toISOString().slice(0, 10);

  const supabase = await createLeaveClient();

  // 1. Verify biometric attendance has been uploaded for this period.
  // Downloading payable days without attendance data is prohibited to prevent payroll discrepancy.
  const [{ count: attendanceRecordsCount }, { count: uploadedMonthsCount }] = await Promise.all([
    supabase
      .from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .gte('date', lwpWindowStart)
      .lte('date', monthEndISO),
    supabase
      .from('uploaded_months')
      .select('key', { count: 'exact', head: true })
      .eq('year', String(year))
      .in('month', [String(month), String(month - 1)]),
  ]);

  const hasAttendance = (attendanceRecordsCount ?? 0) > 0 || (uploadedMonthsCount ?? 0) > 0;
  const allowUnreconciledPreview = searchParams.get('allowUnreconciledPreview') === 'true';

  if (!hasAttendance && !allowUnreconciledPreview) {
    return NextResponse.json(
      {
        error: `Biometric attendance has not been uploaded for ${MONTH_NAMES[month - 1]} ${year} (${lwpWindowStart} to ${lwpWindowEnd}). Downloading payable days without attendance is blocked to prevent payroll discrepancy. Please upload the monthly biometric attendance file first.`,
        hasAttendance: false,
        attendanceRecordsCount: 0,
        year,
        month,
        monthLabel: `${MONTH_NAMES[month - 1]} ${year}`,
        lwpWindow: { start: lwpWindowStart, end: lwpWindowEnd },
      },
      { status: 400 }
    );
  }

  // 2. Fetch non-deleted employees
  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('id, employee_code, full_name, department, office, employment_status, date_of_joining, date_of_exit, is_deleted')
    .eq('is_deleted', false)
    .order('full_name', { ascending: true });

  if (empErr) {
    return NextResponse.json({ error: empErr.message }, { status: 500 });
  }

  // 2. Query F&F calculations for exited employees to obtain exact settlement payable days
  const fnfMap = new Map<string, { last_working_day: string; payable_days: number }>();
  const { data: fnfRows } = await supabase
    .from('fnf_calculations')
    .select('employee_id, last_working_day, payable_days')
    .gte('last_working_day', lwpWindowStart)
    .lte('last_working_day', monthEndISO);

  for (const r of fnfRows ?? []) {
    if (r.employee_id) {
      fnfMap.set(r.employee_id, {
        last_working_day: r.last_working_day,
        payable_days: r.payable_days,
      });
    }
  }

  // 3. Filter and categorize employees (Onboard, Notice, FF Exited)
  interface CategorizedEmployee {
    emp: EmployeeRow;
    category: 'ONBOARD' | 'NOTICE' | 'FF_EXITED';
  }

  const eligibleEmployees: CategorizedEmployee[] = [];
  for (const emp of (employees as EmployeeRow[] ?? [])) {
    // Skip ghost cards: blank name, pure numbers, or name equals employee code
    const name = (emp.full_name || '').trim();
    const code = (emp.employee_code || '').trim();
    if (!name || name.toLowerCase() === code.toLowerCase() || !/[a-zA-Z]/.test(name)) {
      continue;
    }

    // Only include employee if they joined on or before the end of this month
    if (emp.date_of_joining && emp.date_of_joining > monthEndISO) {
      continue;
    }

    const isExited = emp.employment_status === 'exited' || (emp.date_of_exit && emp.date_of_exit <= monthEndISO);
    const hasFnf = fnfMap.has(emp.id);

    if (isExited || hasFnf) {
      // If excludeExited is explicitly toggled by user, skip
      if (excludeExited) continue;

      // Only include exited employee if their exit date / last working day falls in this pay cycle
      const exitDate = emp.date_of_exit || fnfMap.get(emp.id)?.last_working_day;
      if (exitDate && (exitDate < lwpWindowStart || exitDate > monthEndISO)) {
        continue; // Exited prior to this cycle or far in the future
      }
      eligibleEmployees.push({ emp, category: 'FF_EXITED' });
    } else if (emp.employment_status === 'notice_period') {
      eligibleEmployees.push({ emp, category: 'NOTICE' });
    } else {
      eligibleEmployees.push({ emp, category: 'ONBOARD' });
    }
  }

  // 4. Batch count approved LWP days in [lwpWindowStart, lwpWindowEnd]
  const employeeIds = eligibleEmployees.map((e) => e.emp.id);
  const { countMap: lwpCountMap, error: lwpErr } = await getLwpDaysForEmployees(
    supabase,
    employeeIds,
    lwpWindowStart,
    lwpWindowEnd
  );

  if (lwpErr) {
    return NextResponse.json({ error: lwpErr }, { status: 500 });
  }

  // 4b. Detect unmarked/unapplied absences directly from biometric attendance exceptions in [lwpWindowStart, lwpWindowEnd]
  const unmarkedAbsentCountMap = new Map<string, number>();
  try {
    const { absentees } = await getAttendanceExceptionsRange(supabase, lwpWindowStart, lwpWindowEnd);
    for (const a of absentees ?? []) {
      const current = unmarkedAbsentCountMap.get(a.employeeId) ?? 0;
      unmarkedAbsentCountMap.set(a.employeeId, current + 1);
    }
  } catch (err) {
    console.warn('Could not fetch attendance exceptions for cycle:', err);
  }

  // 4c. Fetch current FY leave balances so HR knows if unmarked absentees have Paid Leave (SL/CL/PL) available
  const fyStartYear = getFYStartYear(new Date(year, month - 1, 15));
  const { rows: balanceRows } = await getEmployeeBalancesByFY(supabase, fyStartYear);
  const balanceMap = new Map<string, { SL: number; CL: number; PL: number }>();
  for (const b of balanceRows ?? []) {
    balanceMap.set(b.employeeId, { SL: b.SL, CL: b.CL, PL: b.PL });
  }

  // 5. Calculate payable days per employee using fixed 30-day base
  let totalPayableDaysSum = 0;
  let totalLwpDaysSum = 0;
  let totalUnmarkedAbsentDaysSum = 0;
  let onboardCount = 0;
  let noticeCount = 0;
  let ffExitedCount = 0;

  const resultRows = eligibleEmployees.map(({ emp, category }) => {
    let employeeGrossDays = STANDARD_MONTH_BASE;
    let note = '';
    const lwpDays = lwpCountMap.get(emp.id) ?? 0;
    const unmarkedAbsentDays = unmarkedAbsentCountMap.get(emp.id) ?? 0;
    const balances = balanceMap.get(emp.id) ?? { SL: 0, CL: 0, PL: 0 };
    const paidBalanceAvailable = Number((balances.SL + balances.CL + balances.PL).toFixed(2));
    const totalDeductedDays = lwpDays + unmarkedAbsentDays;
    let payableDays = 0;

    if (category === 'FF_EXITED') {
      ffExitedCount++;
      const fnf = fnfMap.get(emp.id);
      if (fnf) {
        payableDays = fnf.payable_days;
        employeeGrossDays = Math.min(parseInt(fnf.last_working_day.slice(8, 10), 10) || STANDARD_MONTH_BASE, STANDARD_MONTH_BASE);
        note = `F&F Settlement: LWD ${fnf.last_working_day}, ${payableDays} payable days (pre-computed).`;
      } else {
        const exitDay = emp.date_of_exit ? parseInt(emp.date_of_exit.slice(8, 10), 10) : STANDARD_MONTH_BASE;
        employeeGrossDays = Math.min(exitDay, STANDARD_MONTH_BASE);
        payableDays = Math.max(0, Math.round((employeeGrossDays - totalDeductedDays) * 100) / 100);
        note = `Exited on ${emp.date_of_exit ?? 'this month'}. Gross clamped to ${employeeGrossDays} days.`;
      }
    } else if (category === 'NOTICE') {
      noticeCount++;
      payableDays = Math.max(0, Math.round((employeeGrossDays - totalDeductedDays) * 100) / 100);
      note = `Notice period (exit: ${emp.date_of_exit ?? 'TBD'}). Standard 30-day base.`;
    } else {
      onboardCount++;
      // Check if new joiner mid-month and clamping is requested
      if (clampNewJoiners && emp.date_of_joining) {
        const isJoiningInMonth = emp.date_of_joining.startsWith(`${year}-${String(month).padStart(2, '0')}`);
        if (isJoiningInMonth) {
          const dojDay = parseInt(emp.date_of_joining.slice(8, 10), 10);
          if (dojDay > 1) {
            // Prorated from joining day to end of 30-day base
            employeeGrossDays = Math.max(0, STANDARD_MONTH_BASE - dojDay + 1);
            note = `New joiner on ${emp.date_of_joining}. Prorated from DOJ: ${employeeGrossDays} gross days.`;
          }
        }
      }
      payableDays = Math.max(0, Math.round((employeeGrossDays - totalDeductedDays) * 100) / 100);
    }

    if (unmarkedAbsentDays > 0) {
      if (paidBalanceAvailable >= unmarkedAbsentDays) {
        const unmarkedNote = `${unmarkedAbsentDays} unmarked absence day(s) detected. Has ${paidBalanceAvailable} paid balance available (${balances.SL} SL, ${balances.CL} CL, ${balances.PL} PL) — can be marked as Paid Leave in Absentees panel.`;
        note = note ? `${note} • ${unmarkedNote}` : unmarkedNote;
      } else {
        const unmarkedNote = `${unmarkedAbsentDays} unmarked absence day(s) detected. Insufficient paid balance (${paidBalanceAvailable} available) — deducted as LWP.`;
        note = note ? `${note} • ${unmarkedNote}` : unmarkedNote;
      }
    }

    totalPayableDaysSum += payableDays;
    totalLwpDaysSum += lwpDays;
    totalUnmarkedAbsentDaysSum += unmarkedAbsentDays;

    return {
      employeeId: emp.id,
      employeeCode: emp.employee_code,
      name: emp.full_name,
      department: emp.department ?? 'General',
      office: emp.office ?? 'WonderBiz',
      category,
      employmentStatus: emp.employment_status,
      dateOfJoining: emp.date_of_joining,
      dateOfExit: emp.date_of_exit,
      standardBaseDays: STANDARD_MONTH_BASE,
      totalDaysInMonth: employeeGrossDays,
      lwpDays,
      unmarkedAbsentDays,
      totalDeductedDays,
      availableBalances: {
        sl: balances.SL,
        cl: balances.CL,
        pl: balances.PL,
        totalPaid: paidBalanceAvailable,
      },
      payableDays,
      notes: note,
    };
  });

  return NextResponse.json({
    year,
    month,
    monthLabel: `${MONTH_NAMES[month - 1]} ${year}`,
    hasAttendance,
    attendanceRecordsCount: attendanceRecordsCount ?? 0,
    standardBaseDays: STANDARD_MONTH_BASE,
    daysInMonth,
    lwpWindow: {
      start: lwpWindowStart,
      end: lwpWindowEnd,
    },
    options: {
      clampNewJoiners,
      excludeExited,
    },
    summary: {
      totalEmployees: resultRows.length,
      onboardCount,
      noticeCount,
      ffExitedCount,
      totalGrossDays: resultRows.length * STANDARD_MONTH_BASE,
      totalPayableDays: Math.round(totalPayableDaysSum * 100) / 100,
      totalLwpDays: Math.round(totalLwpDaysSum * 100) / 100,
      totalUnmarkedAbsentDays: Math.round(totalUnmarkedAbsentDaysSum * 100) / 100,
      unmarkedAbsentEmployeeCount: resultRows.filter((r) => (r.unmarkedAbsentDays ?? 0) > 0).length,
    },
    employees: resultRows,
  });
}
