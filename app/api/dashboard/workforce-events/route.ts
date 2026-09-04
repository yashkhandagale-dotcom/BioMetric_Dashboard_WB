import { NextRequest, NextResponse } from 'next/server';
import { createClient as createDashboardClient } from '@/lib/supabase/server';
import { createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { WorkforceEvent, WorkforceEventType } from '@/lib/types';

// D7-3 (stretch): same shape/pattern as app/api/dashboard/leave-records/
// route.ts — sits outside /api/leave/* on purpose so it's gated by the
// main dashboard's own session (middleware.ts), then reaches into the
// Leave Tracker project with ITS service-role key for the actual read.

interface WorkforceEventRow {
  event_type: WorkforceEventType;
  event_date: string;
  note: string | null;
  employees: { employee_code: string; office: string } | { employee_code: string; office: string }[] | null;
}

function firstOf<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function monthBounds(year: string, month: string): { start: string; end: string } {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const lastDay = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

export async function GET(req: NextRequest) {
  const dashboardClient = await createDashboardClient();
  const {
    data: { user },
  } = await dashboardClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const monthKeysParam = req.nextUrl.searchParams.get('monthKeys');
  const monthKeys = (monthKeysParam ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  if (monthKeys.length === 0) {
    return NextResponse.json({ events: [] as WorkforceEvent[] });
  }

  // Extract unique (year, month) pairs across all requested monthKeys.
  // We no longer filter by office in the query — matching is done purely on
  // employee_code + date so variations in office naming never drop events.
  const uniqueMonths = new Map<string, { year: string; month: string }>();
  for (const key of monthKeys) {
    const parts = key.split('_');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      const ym = `${parts[0]}_${parts[1]}`;
      if (!uniqueMonths.has(ym)) {
        uniqueMonths.set(ym, { year: parts[0], month: parts[1] });
      }
    }
  }

  const months = Array.from(uniqueMonths.values());
  if (months.length === 0) {
    return NextResponse.json({ events: [] as WorkforceEvent[] });
  }

  let leaveService;
  try {
    leaveService = createLeaveServiceClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Leave Tracker is not reachable (config error): ${message}`, events: [] },
      { status: 502 }
    );
  }

  const bounds = months.map((m) => monthBounds(m.year, m.month));
  const rangeStart = bounds.reduce((min, b) => (b.start < min ? b.start : min), bounds[0].start);
  const rangeEnd = bounds.reduce((max, b) => (b.end > max ? b.end : max), bounds[0].end);

  const { data, error } = await leaveService
    .from('workforce_events')
    .select('event_type, event_date, note, employees!inner(employee_code, office)')
    .gte('event_date', rangeStart)
    .lte('event_date', rangeEnd)
    .returns<WorkforceEventRow[]>();

  if (error) {
    return NextResponse.json(
      { error: `Could not read workforce events from the Leave Tracker: ${error.message}`, events: [] },
      { status: 502 }
    );
  }

  const allEvents: WorkforceEvent[] = [];
  const seen = new Set<string>();

  for (const row of data ?? []) {
    const employee = firstOf(row.employees);
    if (!employee) continue;

    const dedupeKey = `${employee.employee_code}_${row.event_date}_${row.event_type}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    allEvents.push({
      employeeCode: employee.employee_code,
      officeCode: employee.office,
      date: row.event_date,
      eventType: row.event_type,
      note: row.note ?? undefined,
    });
  }

  return NextResponse.json({ events: allEvents });
}