import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getLwpDaysForEmployees } from '@/lib/leaveSupabase/lwpDayCount';

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
    const searchParams = req.nextUrl.searchParams;
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

  // Days in calendar month M
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthStartISO = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEndISO = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  // LWP window: fixed [25th of month M-1, 24th of month M]
  const lwpStartDate = new Date(Date.UTC(year, month - 2, 25));
  const lwpWindowStart = lwpStartDate.toISOString().slice(0, 10);
  const lwpEndDate = new Date(Date.UTC(year, month - 1, 24));
  const lwpWindowEnd = lwpEndDate.toISOString().slice(0, 10);

  const supabase = await createLeaveClient();

  // 1. Fetch non-deleted employees
  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('id, employee_code, full_name, department, office, employment_status, date_of_joining, date_of_exit, is_deleted')
    .eq('is_deleted', false)
    .order('full_name', { ascending: true });

  if (empErr) {
    return NextResponse.json({ error: empErr.message }, { status: 500 });
  }

  // 2. If excludeExited is true, check fnf_calculations in window as well
  const fnfEmployeeIds = new Set<string>();
  if (excludeExited) {
    const { data: fnfRows } = await supabase
      .from('fnf_calculations')
      .select('employee_id, last_working_day')
      .gte('last_working_day', lwpWindowStart)
      .lte('last_working_day', monthEndISO);

    for (const r of fnfRows ?? []) {
      if (r.employee_id) fnfEmployeeIds.add(r.employee_id);
    }
  }

  // 3. Filter eligible active employees
  const eligibleEmployees: EmployeeRow[] = [];
  for (const emp of (employees as EmployeeRow[] ?? [])) {
    if (excludeExited) {
      if (emp.employment_status === 'exited') continue;
      if (fnfEmployeeIds.has(emp.id)) continue;
      if (emp.date_of_exit && emp.date_of_exit >= lwpWindowStart && emp.date_of_exit <= monthEndISO) {
        continue;
      }
    }
    // Only include employee if they joined on or before the end of this month
    if (emp.date_of_joining && emp.date_of_joining > monthEndISO) {
      continue;
    }
    eligibleEmployees.push(emp);
  }

  // 4. Batch count LWP days in [lwpWindowStart, lwpWindowEnd]
  const employeeIds = eligibleEmployees.map((e) => e.id);
  const { countMap: lwpCountMap, error: lwpErr } = await getLwpDaysForEmployees(
    supabase,
    employeeIds,
    lwpWindowStart,
    lwpWindowEnd
  );

  if (lwpErr) {
    return NextResponse.json({ error: lwpErr }, { status: 500 });
  }

  // 5. Calculate payable days per employee
  let totalPayableDaysSum = 0;
  let totalLwpDaysSum = 0;

  const resultRows = eligibleEmployees.map((emp) => {
    let employeeGrossDays = daysInMonth;
    let note = '';

    // Check if new joiner mid-month and clamping is requested
    if (clampNewJoiners && emp.date_of_joining) {
      const isJoiningInMonth = emp.date_of_joining.startsWith(`${year}-${String(month).padStart(2, '0')}`);
      if (isJoiningInMonth) {
        const dojDay = parseInt(emp.date_of_joining.slice(8, 10), 10);
        if (dojDay > 1) {
          employeeGrossDays = Math.max(0, daysInMonth - dojDay + 1);
          note = `Clamped to DOJ (${emp.date_of_joining}): ${employeeGrossDays} days`;
        }
      }
    }

    const lwpDays = lwpCountMap.get(emp.id) ?? 0;
    const payableDays = Math.max(0, Math.round((employeeGrossDays - lwpDays) * 100) / 100);

    totalPayableDaysSum += payableDays;
    totalLwpDaysSum += lwpDays;

    return {
      employeeId: emp.id,
      employeeCode: emp.employee_code,
      name: emp.full_name,
      department: emp.department ?? 'General',
      office: emp.office ?? 'WonderBiz',
      employmentStatus: emp.employment_status,
      dateOfJoining: emp.date_of_joining,
      totalDaysInMonth: employeeGrossDays,
      lwpDays,
      payableDays,
      notes: note,
    };
  });

  return NextResponse.json({
    year,
    month,
    monthLabel: `${MONTH_NAMES[month - 1]} ${year}`,
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
      totalGrossDays: resultRows.length * daysInMonth,
      totalPayableDays: Math.round(totalPayableDaysSum * 100) / 100,
      totalLwpDays: Math.round(totalLwpDaysSum * 100) / 100,
    },
    employees: resultRows,
  });
}
