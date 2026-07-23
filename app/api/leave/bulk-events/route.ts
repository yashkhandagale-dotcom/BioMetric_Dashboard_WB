import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';

const EVENT_TYPES = ['wfh', 'business_travel', 'office_shutdown'] as const;
type EventType = (typeof EVENT_TYPES)[number];

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

// D6-3: one row per employee per day in the range — a 5-employee,
// 3-day WFH event is 15 rows, not one "event" row with a range on it,
// so downstream reads (attendance merge, reporting) never have to
// re-expand a range themselves. Upserts with the migration's
// (employee_id, event_date, event_type) unique constraint and
// ignoreDuplicates, so re-submitting the same event is a no-op rather
// than a duplicate-row error — safe to retry from the UI.
export async function POST(req: NextRequest) {
  const sessionClient = await createLeaveClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json();
  const {
    event_type,
    start_date,
    end_date,
    employee_ids,
    office,
    note,
  }: {
    event_type?: string;
    start_date?: string;
    end_date?: string;
    employee_ids?: string[];
    office?: string;
    note?: string;
  } = body;

  if (!event_type || !EVENT_TYPES.includes(event_type as EventType)) {
    return NextResponse.json({ error: `event_type must be one of ${EVENT_TYPES.join(', ')}` }, { status: 400 });
  }
  if (!start_date || !end_date) {
    return NextResponse.json({ error: 'start_date and end_date are required' }, { status: 400 });
  }
  if (new Date(end_date) < new Date(start_date)) {
    return NextResponse.json({ error: 'end_date cannot be before start_date' }, { status: 400 });
  }
  const hasEmployeeIds = Array.isArray(employee_ids) && employee_ids.length > 0;
  const hasOffice = !!office && office.trim().length > 0;
  if (!hasEmployeeIds && !hasOffice) {
    return NextResponse.json({ error: 'Provide employee_ids and/or an office' }, { status: 400 });
  }

  const service = createLeaveServiceClient();

  const targetIds = new Set<string>(hasEmployeeIds ? employee_ids : []);
  if (hasOffice) {
    const { data: officeEmployees, error: officeError } = await service
      .from('employees')
      .select('id')
      .eq('office', office);
    if (officeError) {
      return NextResponse.json({ error: officeError.message }, { status: 400 });
    }
    for (const e of officeEmployees ?? []) targetIds.add(e.id);
  }

  if (targetIds.size === 0) {
    return NextResponse.json({ error: 'No employees matched the given office/employee_ids' }, { status: 400 });
  }

  const dates = expandDateRange(start_date, end_date);

  const { data: hrEmployee } = await service.from('employees').select('id').eq('auth_user_id', user.id).maybeSingle();

  const rows = Array.from(targetIds).flatMap((employeeId) =>
    dates.map((eventDate) => ({
      employee_id: employeeId,
      event_type,
      event_date: eventDate,
      note: note || null,
      created_by: hrEmployee?.id ?? null,
    }))
  );

  const { data: inserted, error: insertError } = await service
    .from('workforce_events')
    .upsert(rows, { onConflict: 'employee_id,event_date,event_type', ignoreDuplicates: true })
    .select('id');

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({
    created: inserted?.length ?? 0,
    requested: rows.length,
    employees_affected: targetIds.size,
    days: dates.length,
  });
}