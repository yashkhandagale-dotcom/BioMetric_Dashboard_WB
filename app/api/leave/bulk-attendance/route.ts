import { NextRequest, NextResponse } from 'next/server';
import { createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';
import { getPredefinedHolidays } from '@/lib/predefinedHolidays';
import { isPunchTimeValid } from '@/lib/parseCSV';

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UPSERT_BATCH_SIZE = 500;

function expandDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  while (cursor <= endDate) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

export async function POST(req: NextRequest) {
  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Not authorized. HR privileges required.' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const {
    employee_ids,
    start_date,
    end_date,
    status,
    day_type = 'full',
    half_day_session = 'first_half',
    overwrite_existing_punch = false,
  }: {
    employee_ids?: string[];
    start_date?: string;
    end_date?: string;
    status?: 'Present' | 'Absent';
    day_type?: 'full' | 'half';
    half_day_session?: 'first_half' | 'second_half';
    overwrite_existing_punch?: boolean;
  } = body;

  if (!status || (status !== 'Present' && status !== 'Absent')) {
    return NextResponse.json({ error: 'Status must be "Present" or "Absent"' }, { status: 400 });
  }
  if (!start_date || !end_date) {
    return NextResponse.json({ error: 'Start and end dates are required' }, { status: 400 });
  }
  if (end_date < start_date) {
    return NextResponse.json({ error: 'End date cannot be before start date' }, { status: 400 });
  }
  if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one employee' }, { status: 400 });
  }

  const service = createLeaveServiceClient();

  // 1. Fetch targeted employees
  const { data: employees, error: empError } = await service
    .from('employees')
    .select('id, employee_code, full_name, department, office')
    .in('id', employee_ids)
    .neq('employment_status', 'exited');

  if (empError) {
    return NextResponse.json({ error: `Failed to fetch employees: ${empError.message}` }, { status: 400 });
  }
  if (!employees || employees.length === 0) {
    return NextResponse.json({ error: 'No active employees matched the selection' }, { status: 400 });
  }

  const dates = expandDateRange(start_date, end_date);
  const years = Array.from(new Set(dates.map((d) => parseInt(d.slice(0, 4), 10))));
  const offices = Array.from(new Set(employees.map((e) => e.office)));
  const empIds = employees.map((e) => e.id);
  const empCodes = employees.map((e) => e.employee_code);

  // 2. Fetch custom holidays for the offices and years in range
  const { data: customHolidays, error: chError } = await service
    .from('custom_holidays')
    .select('office_code, date, name')
    .in('office_code', offices)
    .in('year', years.map(String));

  if (chError) {
    return NextResponse.json({ error: `Failed to fetch holidays: ${chError.message}` }, { status: 400 });
  }

  // Build office -> Set of holiday dates
  const holidayDatesByOffice = new Map<string, Set<string>>();
  for (const off of offices) {
    const set = new Set<string>();
    for (const yr of years) {
      for (const h of getPredefinedHolidays(off, yr)) {
        set.add(h.date);
      }
    }
    for (const ch of customHolidays ?? []) {
      if (ch.office_code === off) {
        set.add(ch.date);
      }
    }
    holidayDatesByOffice.set(off, set);
  }

  // 3. Fetch approved or auto_lwp leave requests overlapping the range
  const { data: leaveRequests, error: leaveError } = await service
    .from('leave_requests')
    .select('employee_id, start_date, end_date')
    .in('employee_id', empIds)
    .in('status', ['approved', 'auto_lwp'])
    .lte('start_date', end_date)
    .gte('end_date', start_date);

  if (leaveError) {
    return NextResponse.json({ error: `Failed to fetch leaves: ${leaveError.message}` }, { status: 400 });
  }

  const leavesByEmployee = new Map<string, { start: string; end: string }[]>();
  for (const lr of leaveRequests ?? []) {
    const existing = leavesByEmployee.get(lr.employee_id) ?? [];
    existing.push({ start: lr.start_date, end: lr.end_date });
    leavesByEmployee.set(lr.employee_id, existing);
  }

  // 4. Fetch existing attendance records to protect real biometric punches
  const { data: existingAttendance, error: attError } = await service
    .from('attendance_records')
    .select('employee_code, date, office_code, in_time, out_time, punch_count, punch_records, status')
    .in('employee_code', empCodes)
    .gte('date', start_date)
    .lte('date', end_date);

  if (attError) {
    return NextResponse.json({ error: `Failed to check existing attendance: ${attError.message}` }, { status: 400 });
  }

  const existingAttendanceMap = new Map<string, any>();
  for (const att of existingAttendance ?? []) {
    existingAttendanceMap.set(`${att.employee_code}__${att.date}`, att);
  }

  // 5. Run exclusion check pass
  let skippedWeeklyOff = 0;
  let skippedHoliday = 0;
  let skippedLeave = 0;
  let skippedExistingPunch = 0;

  const validRecords: any[] = [];
  const neededMonthKeys = new Map<string, { key: string; office_code: string; month: string; year: string }>();

  for (const emp of employees) {
    const empLeaves = leavesByEmployee.get(emp.id) ?? [];
    const empOfficeHolidays = holidayDatesByOffice.get(emp.office) ?? new Set<string>();

    for (const date of dates) {
      // 5a. Skip weekly-offs
      if (isWeekend(date)) {
        skippedWeeklyOff++;
        continue;
      }

      // 5b. Skip holidays
      if (empOfficeHolidays.has(date)) {
        skippedHoliday++;
        continue;
      }

      // 5c. Skip approved/pre-marked leave
      const hasApprovedLeave = empLeaves.some((lr) => date >= lr.start && date <= lr.end);
      if (hasApprovedLeave) {
        skippedLeave++;
        continue;
      }

      // 5d. Skip existing real biometric punch
      const existing = existingAttendanceMap.get(`${emp.employee_code}__${date}`);
      if (existing && !overwrite_existing_punch) {
        // Bug fix: this used to also treat `punch_count > 0` and any
        // non-empty `punch_records` as proof of a "real" punch — but a
        // genuinely absent day can still have punch_count/punch_records
        // set to junk/placeholder values by the CSV importer (e.g.
        // punch_count: 1 with in_time/out_time both null) while carrying
        // zero actual evidence anyone was there. That falsely "protected"
        // stale Absent rows from ever being overwritten by this bulk
        // action, silently no-op'ing the mark-present request for exactly
        // the days someone most wanted corrected, while still reporting
        // them as "skipped: existing_punch" with no indication anything
        // was wrong. The only trustworthy signal that real attendance
        // exists is a genuinely parseable in/out punch time — the same
        // isPunchTimeValid() check lib/attendanceExceptions.ts already
        // uses for this identical class of "punch_count lies" bug (see
        // its own comment on the isAbsent() branch), so this can never
        // disagree with what the Absentees/Half-Day tabs already believe
        // about the same row.
        const hasRealPunch = isPunchTimeValid(existing.in_time ?? '') || isPunchTimeValid(existing.out_time ?? '');

        if (hasRealPunch) {
          skippedExistingPunch++;
          continue;
        }
      }

      // 5e. Clean date -> format attendance row
      const [yr, mo] = date.split('-');
      const monthKey = `${yr}_${mo}_${emp.office}`;
      if (!neededMonthKeys.has(monthKey)) {
        neededMonthKeys.set(monthKey, {
          key: monthKey,
          office_code: emp.office,
          month: mo,
          year: yr,
        });
      }

      let inTime: string | null = null;
      let outTime: string | null = null;
      let duration: string | null = '0:00';
      let punchCount = 0;
      let isShortDay = false;
      let punchRecords: string | null = null;

      if (status === 'Present') {
        if (day_type === 'half') {
          isShortDay = true;
          punchCount = 2;
          if (half_day_session === 'second_half') {
            inTime = '14:00';
            outTime = '18:30';
            duration = '4:30';
            punchRecords = '14:00,18:30';
          } else {
            inTime = '09:30';
            outTime = '13:00';
            duration = '3:30';
            punchRecords = '09:30,13:00';
          }
        } else {
          inTime = '09:30';
          outTime = '18:30';
          duration = '9:00';
          punchCount = 2;
          isShortDay = false;
          punchRecords = '09:30,18:30';
        }
      }

      validRecords.push({
        month_key: monthKey,
        employee_code: emp.employee_code,
        employee_name: emp.full_name,
        department: emp.department,
        office_code: emp.office,
        date,
        in_time: inTime,
        out_time: outTime,
        status,
        punch_records: punchRecords,
        duration,
        punch_count: punchCount,
        is_short_day: isShortDay,
        late_by: '0:00',
        early_by: '0:00',
        updated_at: new Date().toISOString(),
      });
    }
  }

  // 6. Ensure uploaded_months rows exist before inserting into attendance_records
  if (neededMonthKeys.size > 0) {
    const monthUpserts = Array.from(neededMonthKeys.values()).map((m) => {
      const monthIdx = parseInt(m.month, 10);
      const monthName = MONTH_NAMES[monthIdx] || m.month;
      return {
        key: m.key,
        label: `${m.office_code} — ${monthName} ${m.year}`,
        office_code: m.office_code,
        month: m.month,
        year: m.year,
      };
    });

    const { error: monthUpsertError } = await service
      .from('uploaded_months')
      .upsert(monthUpserts, { onConflict: 'key' });

    if (monthUpsertError) {
      return NextResponse.json(
        { error: `Failed to prepare month containers: ${monthUpsertError.message}` },
        { status: 500 }
      );
    }
  }

  // 7. Batch upsert valid records into attendance_records
  let writtenCount = 0;
  for (let i = 0; i < validRecords.length; i += UPSERT_BATCH_SIZE) {
    const batch = validRecords.slice(i, i + UPSERT_BATCH_SIZE);
    const { data: inserted, error: insertError } = await service
      .from('attendance_records')
      .upsert(batch, { onConflict: 'employee_code,date,office_code' })
      .select('id');

    if (insertError) {
      return NextResponse.json(
        { error: `Failed to save attendance records: ${insertError.message}` },
        { status: 500 }
      );
    }
    writtenCount += inserted?.length ?? batch.length;
  }

  const totalRequested = employees.length * dates.length;
  const totalSkipped = skippedWeeklyOff + skippedHoliday + skippedLeave + skippedExistingPunch;

  const skipReasons: string[] = [];
  if (skippedWeeklyOff > 0) skipReasons.push(`${skippedWeeklyOff} weekly-offs`);
  if (skippedHoliday > 0) skipReasons.push(`${skippedHoliday} holidays`);
  if (skippedLeave > 0) skipReasons.push(`${skippedLeave} approved leaves`);
  if (skippedExistingPunch > 0) skipReasons.push(`${skippedExistingPunch} existing biometric punches`);

  const skipSummary = skipReasons.length > 0 ? ` (${skipReasons.join(', ')})` : '';
  const message = `Recorded ${writtenCount} attendance row(s) across ${employees.length} employee(s) over ${dates.length} day(s). ${totalSkipped} date(s) skipped${skipSummary}.`;

  return NextResponse.json({
    success: true,
    written: writtenCount,
    requested: totalRequested,
    employees_affected: employees.length,
    days: dates.length,
    skipped: {
      total: totalSkipped,
      weekly_off: skippedWeeklyOff,
      holiday: skippedHoliday,
      approved_leave: skippedLeave,
      existing_punch: skippedExistingPunch,
    },
    message,
  });
}
