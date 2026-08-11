import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';

// D5-4: single query + in-memory aggregation (dataset is one HR-admin
// tool's worth of leave_requests, not a warehouse) feeding all three
// Day 5 charts, so LeaveAnalytics.tsx makes exactly one request.
//
// Deliberately does NOT filter by status — app/api/leave/history/route.ts
// doesn't either — so the "numbers reconcile with the History page for
// the same date range" Day 5 AC actually holds when HR spot-checks by
// setting History's date filters to this same FY window.

type Row = {
  start_date: string;
  total_days: number;
  employees: { department: string } | null;
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

  const fyParam = req.nextUrl.searchParams.get('fy_start_year');
  const fyStartYear = fyParam ? parseInt(fyParam, 10) : getFYStartYear();
  if (Number.isNaN(fyStartYear)) {
    return NextResponse.json({ error: 'fy_start_year must be a number' }, { status: 400 });
  }

  // Same 25-Mar FY cutover as fn_prorate_new_joiner / fn_debit_leave_on_approval.
  const fyStart = `${fyStartYear}-03-25`;
  const fyEnd = `${fyStartYear + 1}-03-24`;

  try {
    const { data, error } = await supabase
      .from('leave_requests')
      .select(
        `
        start_date, total_days,
        employees ( department ),
        leave_types ( code, display_name )
      `
      )
      .gte('start_date', fyStart)
      .lte('start_date', fyEnd)
      .returns<Row[]>();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const byTypeMap = new Map<string, { code: string; label: string; totalDays: number; count: number }>();
    const byMonthMap = new Map<string, number>();
    const byDeptMap = new Map<string, { totalDays: number; count: number }>();

    // Seed all 12 months in FY chronological order (Mar → Feb) with 0, so
    // the trend line never silently skips a month with no leave taken.
    const monthOrder: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(fyStartYear, 2, 1)); // March = month index 2
      d.setUTCMonth(d.getUTCMonth() + i);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthOrder.push(key);
      byMonthMap.set(key, 0);
    }

    for (const r of data ?? []) {
      const lt = r.leave_types;
      const emp = r.employees;

      if (lt) {
        const existing = byTypeMap.get(lt.code) ?? { code: lt.code, label: lt.display_name, totalDays: 0, count: 0 };
        existing.totalDays += r.total_days;
        existing.count += 1;
        byTypeMap.set(lt.code, existing);
      }

      const monthKey = r.start_date.slice(0, 7);
      if (byMonthMap.has(monthKey)) {
        byMonthMap.set(monthKey, (byMonthMap.get(monthKey) ?? 0) + r.total_days);
      }

      if (emp) {
        const existing = byDeptMap.get(emp.department) ?? { totalDays: 0, count: 0 };
        existing.totalDays += r.total_days;
        existing.count += 1;
        byDeptMap.set(emp.department, existing);
      }
    }

    return NextResponse.json({
      fyStartYear,
      fyLabel: formatFYLabel(fyStartYear),
      byType: Array.from(byTypeMap.values()),
      byMonth: monthOrder.map((m) => ({ month: m, totalDays: Math.round((byMonthMap.get(m) ?? 0) * 100) / 100 })),
      byDepartment: Array.from(byDeptMap.entries())
        .map(([department, v]) => ({ department, ...v }))
        .sort((a, b) => b.totalDays - a.totalDays),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to compute analytics: ${message}` }, { status: 500 });
  }
}