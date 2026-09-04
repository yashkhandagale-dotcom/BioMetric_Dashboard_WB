import { NextRequest, NextResponse } from 'next/server';
import { createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { mapTrackerLeaveType } from '@/lib/leaveSupabase/leaveTypeMap';

interface Item {
  employeeCode: string;
  date: string; // YYYY-MM-DD
  officeCode: string;
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const items: Item[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ records: [] });

  let leaveService;
  try {
    leaveService = createLeaveServiceClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Leave Tracker is not reachable (config error): ${message}`, records: [] }, { status: 502 });
  }

  const results: any[] = [];

  // Perform one query per unique (employeeCode, officeCode, date) item.
  // Grouping optimizations could be added later if needed.
  for (const it of items) {
    try {
      const date = it.date;
      const { data, error } = await leaveService
        .from('leave_requests')
        .select('id, start_date, end_date, is_half_day, reason, applied_on, leave_types(code), employees!leave_requests_employee_id_fkey!inner(employee_code, office)')
        .eq('employees.employee_code', it.employeeCode)
        .lte('start_date', date)
        .gte('end_date', date)
        .in('status', ['approved', 'auto_lwp'])
        .returns<any[]>();

      if (error) {
        // ignore per-item failures but continue; collect nothing for this item
        continue;
      }

      for (const row of data ?? []) {
        const employee = Array.isArray(row.employees) ? row.employees[0] : row.employees;
        const leaveType = Array.isArray(row.leave_types) ? row.leave_types[0] : row.leave_types;
        if (!employee || !leaveType) continue;
        const { leaveType: mainType, halfDayLeaveType } = mapTrackerLeaveType(leaveType.code, !!row.is_half_day);
        results.push({
          employeeCode: employee.employee_code,
          officeCode: employee.office,
          date,
          leaveType: mainType,
          halfDayLeaveType,
          markedAt: row.applied_on,
          note: row.reason ?? undefined,
        });
      }
    } catch (err) {
      // swallow and continue
      continue;
    }
  }

  return NextResponse.json({ records: results });
}
