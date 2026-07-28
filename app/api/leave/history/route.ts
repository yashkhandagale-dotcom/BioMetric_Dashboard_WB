import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { TrackerLeaveTypeCode } from '@/lib/leaveSupabase/leaveTypeMap';
import { selectAllRows } from '@/lib/attendanceExceptions';

// D3-2: backs the Leave History page's table + CSV export. Filters
// compose (department + date range together, etc — Day 3 AC) because
// every filter narrows the same query rather than being applied in
// isolation.
//
// Employee-side filters (employee_id, department, office) are resolved
// to a concrete list of employee ids first, then applied to
// leave_requests with `.in('employee_id', ids)`, instead of filtering on
// the embedded `employees` resource directly — that keeps this query's
// behavior simple and predictable rather than depending on PostgREST's
// embedded-filter (`!inner`) semantics.
//
// Calendar reuse (leave-tracker-calendar task): the month calendar needs
// "every request that overlaps this month" (start_date <= monthEnd AND
// end_date >= monthStart), which is a different comparison than this
// route's existing table-view semantics of "every request that *started*
// in this window" (start_date >= X AND start_date <= Y). Rather than
// change the existing behavior (the History tab's Start/End Date filters
// already rely on it), an explicit `range_mode=overlap` opt-in switches
// to the overlap comparison; omitted/any other value keeps the original
// behavior so no existing caller changes shape.
//
// Also pages the leave_requests query through selectAllRows (the same
// helper lib/attendanceExceptions.ts uses) — a plain .select() caps at
// 1000 rows, and a month/quarter-wide org query here is exactly the kind
// of wide-range query that bug already bit once for attendance_records.

type HistoryRow = {
  id: string;
  start_date: string;
  end_date: string;
  is_half_day: boolean;
  half_day_session: string | null;
  total_days: number;
  status: string;
  source: string;
  is_lwp_override: boolean;
  applied_on: string;
  employees: { id: string; full_name: string; employee_code: string; department: string; office: string } | null;
  leave_types: { code: string; display_name: string } | null;
};

export async function GET(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const startDate = params.get('start_date') || undefined;
  const endDate = params.get('end_date') || undefined;
  const department = params.get('department') || undefined;
  const office = params.get('office') || undefined;
  const employeeId = params.get('employee_id') || undefined;
  const leaveTypeCode = (params.get('leave_type_code') || undefined) as TrackerLeaveTypeCode | undefined;
  const rangeMode = params.get('range_mode') || undefined; // 'overlap' | undefined

  try {
    let employeeIds: string[] | null = null;

    if (employeeId) {
      employeeIds = [employeeId];
    } else if (department || office) {
      let empQuery = supabase.from('employees').select('id');
      if (department) empQuery = empQuery.eq('department', department);
      if (office) empQuery = empQuery.eq('office', office);
      const { data: matched, error: empError } = await empQuery;
      if (empError) {
        return NextResponse.json({ error: empError.message }, { status: 400 });
      }
      employeeIds = (matched ?? []).map((e) => e.id);
      if (employeeIds.length === 0) {
        return NextResponse.json({ requests: [] });
      }
    }

    let leaveTypeId: string | undefined;
    if (leaveTypeCode) {
      const { data: lt, error: ltError } = await supabase
        .from('leave_types')
        .select('id')
        .eq('code', leaveTypeCode)
        .maybeSingle();
      if (ltError) {
        return NextResponse.json({ error: ltError.message }, { status: 400 });
      }
      if (!lt) {
        return NextResponse.json({ requests: [] });
      }
      leaveTypeId = lt.id;
    }

    const { data, error } = await selectAllRows<HistoryRow>((from, to) => {
      let query = supabase
        .from('leave_requests')
        .select(
          `
          id, start_date, end_date, is_half_day, half_day_session, total_days,
          status, source, is_lwp_override, applied_on,
          employees ( id, full_name, employee_code, department, office ),
          leave_types ( code, display_name )
        `
        )
        .order('start_date', { ascending: false })
        .range(from, to);

      if (rangeMode === 'overlap') {
        // Overlap comparison: any request that touches the window at
        // all, not just ones that started inside it — a request that
        // started in June and runs into July must still show up on
        // July's calendar.
        if (endDate) query = query.lte('start_date', endDate);
        if (startDate) query = query.gte('end_date', startDate);
      } else {
        if (startDate) query = query.gte('start_date', startDate);
        if (endDate) query = query.lte('start_date', endDate);
      }
      if (employeeIds) query = query.in('employee_id', employeeIds);
      if (leaveTypeId) query = query.eq('leave_type_id', leaveTypeId);

      return query.returns<HistoryRow[]>();
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const requests = (data ?? [])
      .filter((r) => r.employees && r.leave_types)
      .map((r) => ({
        id: r.id,
        employeeId: r.employees!.id,
        employeeName: r.employees!.full_name,
        employeeCode: r.employees!.employee_code,
        department: r.employees!.department,
        office: r.employees!.office,
        leaveTypeCode: r.leave_types!.code,
        leaveTypeLabel: r.leave_types!.display_name,
        startDate: r.start_date,
        endDate: r.end_date,
        isHalfDay: r.is_half_day,
        halfDaySession: r.half_day_session,
        totalDays: r.total_days,
        status: r.status,
        isLwpOverride: r.is_lwp_override,
        appliedOn: r.applied_on,
        // No standalone "recorded by" column exists on leave_requests —
        // every entry today comes through the HR-manual path (source
        // 'hr_manual'; employee self-service apply is explicitly WON'T
        // scope this sprint per the Scope (MoSCoW) tab), so `source` is
        // the accurate, honest answer to "who recorded this" for now.
        recordedBy: r.source === 'hr_manual' ? 'HR (manual entry)' : 'Employee self-service',
      }));

    return NextResponse.json({ requests });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to load leave history: ${message}` }, { status: 500 });
  }
}
