import { NextRequest, NextResponse } from 'next/server';
import { createClient as createDashboardClient } from '@/lib/supabase/server';
import { createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { mapTrackerLeaveType, TrackerLeaveTypeCode } from '@/lib/leaveSupabase/leaveTypeMap';
import { LeaveRecord } from '@/lib/types';

// Deliberately NOT under /api/leave/* — routes there are treated by
// middleware.ts as belonging to the Leave Tracker's own app (its own
// session, no main-dashboard auth gate). This route is consumed BY the
// main dashboard, so it needs to sit behind the main dashboard's own
// session check, which middleware.ts already enforces for any path that
// isn't /leave or /api/leave. It then reaches across to the Tracker's
// project using ITS service-role key (server-side only, never exposed to
// the browser) — this is the live-read replacement for the old
// leaveSync.ts write-through: no duplicated copy, so nothing can drift.

interface TrackerLeaveRow {
  id: string;
  start_date: string;
  end_date: string;
  is_half_day: boolean;
  reason: string | null;
  applied_on: string;
  leave_types: { code: TrackerLeaveTypeCode } | { code: TrackerLeaveTypeCode }[] | null;
  employees: { employee_code: string; office: string } | { employee_code: string; office: string }[] | null;
}

function firstOf<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

// month is the 2-digit MM segment of a monthKey; returns [YYYY-MM-01, YYYY-MM-lastDay]
function monthBounds(year: string, month: string): { start: string; end: string } {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this month
  const mm = String(m).padStart(2, '0');
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

function expandClipped(startDate: string, endDate: string, clipStart: string, clipEnd: string): string[] {
  const dates: string[] = [];
  const from = startDate > clipStart ? startDate : clipStart;
  const to = endDate < clipEnd ? endDate : clipEnd;
  let cur = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  while (cur.getTime() <= last.getTime()) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

export async function GET(req: NextRequest) {
  const dashboardClient = await createDashboardClient();
  const { data: { user } } = await dashboardClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const monthKeysParam = req.nextUrl.searchParams.get('monthKeys');
  const monthKeys = (monthKeysParam ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  if (monthKeys.length === 0) {
    return NextResponse.json({ records: [] as LeaveRecord[] });
  }

  // Group by officeCode so we issue one query per office covering the
  // union of its requested months, instead of one query per monthKey.
  const byOffice = new Map<string, { year: string; month: string }[]>();
  for (const key of monthKeys) {
    const parts = key.split('_');
    if (parts.length < 3) continue;
    const [year, month, officeCode] = parts;
    const list = byOffice.get(officeCode) ?? [];
    list.push({ year, month });
    byOffice.set(officeCode, list);
  }

  let leaveService;
  try {
    leaveService = createLeaveServiceClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Leave Tracker is not reachable (config error): ${message}`, records: [] },
      { status: 502 }
    );
  }

  const allRecords: LeaveRecord[] = [];

  for (const [officeCode, months] of byOffice) {
    const bounds = months.map((m) => monthBounds(m.year, m.month));
    const rangeStart = bounds.reduce((min, b) => (b.start < min ? b.start : min), bounds[0].start);
    const rangeEnd = bounds.reduce((max, b) => (b.end > max ? b.end : max), bounds[0].end);

    const { data, error } = await leaveService
      .from('leave_requests')
      .select('id, start_date, end_date, is_half_day, reason, applied_on, leave_types(code), employees!inner(employee_code, office)')
      .eq('status', 'approved')
      .eq('employees.office', officeCode)
      .lte('start_date', rangeEnd)
      .gte('end_date', rangeStart)
      .returns<TrackerLeaveRow[]>();

    if (error) {
      return NextResponse.json(
        { error: `Could not read leave data from the Leave Tracker: ${error.message}`, records: [] },
        { status: 502 }
      );
    }

    for (const row of data ?? []) {
      const employee = firstOf(row.employees);
      const leaveType = firstOf(row.leave_types);
      if (!employee || !leaveType) continue;

      for (const bound of bounds) {
        const days = expandClipped(row.start_date, row.end_date, bound.start, bound.end);
        for (const date of days) {
          const { leaveType: mainType, halfDayLeaveType } = mapTrackerLeaveType(leaveType.code, !!row.is_half_day);
          allRecords.push({
            employeeCode: employee.employee_code,
            officeCode: employee.office,
            date,
            leaveType: mainType,
            halfDayLeaveType,
            markedAt: row.applied_on,
            note: row.reason ?? undefined,
          } satisfies LeaveRecord);
        }
      }
    }
  }

  return NextResponse.json({ records: allRecords });
}
