import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getPredefinedHolidays } from '@/lib/predefinedHolidays';
import { selectAllRows } from '@/lib/attendanceExceptions';

// Backs the calendar's holiday overlay layer (see the Leave Tracker
// Calendar brief, section 1.3) — the calendar needs to render holidays
// as a distinct, de-emphasized layer separate from leave/absence
// markers. Predefined holidays (lib/predefinedHolidays.ts) are static
// data and could be computed client-side, but custom_holidays lives in
// this project's Supabase and had no route serving it to any client yet,
// so both are combined here in one response keyed by date, the same way
// lib/attendanceExceptions.ts's buildHolidayLookup does it for the
// Absentees/Half Day classification — reusing that same source list
// rather than re-deriving which dates count as holidays a second time.
//
// ?start_date=&end_date=  (both required) — every office's holidays in
// that range. Offices are read from every employee currently in the
// system rather than requiring the caller to know office codes ahead of
// time.
export async function GET(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const startDateParam = req.nextUrl.searchParams.get('start_date');
  const endDateParam = req.nextUrl.searchParams.get('end_date');
  if (!startDateParam || !endDateParam) {
    return NextResponse.json({ error: 'start_date and end_date are required' }, { status: 400 });
  }
  const startDate: string = startDateParam;
  const endDate: string = endDateParam;

  try {
    const startYear = Number(startDate.slice(0, 4));
    const endYear = Number(endDate.slice(0, 4));
    const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => String(startYear + i));

    const { data: offices, error: officesError } = await supabase
      .from('employees')
      .select('office')
      .neq('employment_status', 'exited');
    if (officesError) {
      return NextResponse.json({ error: officesError.message }, { status: 400 });
    }
    const officeCodes = Array.from(new Set((offices ?? []).map((o) => o.office)));

    const { data: customHolidays, error: customError } = await selectAllRows<{
      office_code: string;
      date: string;
      name: string;
    }>((from, to) =>
      supabase.from('custom_holidays').select('office_code, date, name').in('year', years).range(from, to)
    );
    if (customError) {
      return NextResponse.json({ error: customError.message }, { status: 400 });
    }

    const byDate = new Map<string, { date: string; name: string; offices: string[] }>();
    function addHoliday(date: string, name: string, office: string) {
      if (date < startDate || date > endDate) return;
      const existing = byDate.get(date);
      if (existing) {
        if (!existing.offices.includes(office)) existing.offices.push(office);
      } else {
        byDate.set(date, { date, name, offices: [office] });
      }
    }

    for (const office of officeCodes) {
      for (const year of years) {
        for (const h of getPredefinedHolidays(office, year)) addHoliday(h.date, h.name, office);
      }
    }
    for (const h of customHolidays ?? []) addHoliday(h.date, h.name, h.office_code);

    const holidays = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
    return NextResponse.json({ holidays });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to load holidays: ${message}`, holidays: [] }, { status: 500 });
  }
}
