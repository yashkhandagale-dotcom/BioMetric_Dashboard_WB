import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { selectAllRows } from '@/lib/attendanceExceptions';
import { requireHrAccess } from '@/lib/leaveSupabase/leaveAnalytics/auth';
import { parseAnalyticsFilters } from '@/lib/leaveSupabase/leaveAnalytics/filters';
import { addDays, getUTCDayOfWeek, isWorkingDay } from '@/lib/leaveSupabase/leaveAnalytics/calendar';
import { resolveHolidaysForWindow } from '@/lib/leaveSupabase/leaveAnalytics/holidays';

interface PlannerOpportunity {
  id: string;
  title: string;
  type: 'long_weekend' | 'bridge_day' | 'multi_day_holiday';
  holidayName: string;
  holidayDates: string[];
  bridgeDates: string[]; // working days that form bridge
  totalOpportunityDays: number;
  offices: string[];
  approvedEmployeesCount: number;
  pendingEmployeesCount: number;
  totalLeaveCount: number;
  departmentBreakdown: Array<{
    department: string;
    approved: number;
    pending: number;
  }>;
}

export async function GET(req: NextRequest) {
  const auth = await requireHrAccess();
  if (!auth.authorized) return auth.response;

  const parsed = parseAnalyticsFilters(req.nextUrl.searchParams);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { filters } = parsed;
  const supabase = await createLeaveClient();

  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const horizonEndDate = addDays(todayStr, 90);

    // 1. Fetch non-deleted employees
    const { data: allEmployees, error: empErr } = await selectAllRows<any>((from, to) =>
      (supabase
        .from('employees')
        .select('id, full_name, employee_code, department, office, employment_status, is_deleted')
        .eq('is_deleted', false) as any)
        .range(from, to)
    );

    if (empErr) {
      return NextResponse.json({ error: `Failed to load employees: ${empErr.message}` }, { status: 500 });
    }

    const filteredEmployees = (allEmployees ?? []).filter((e) => {
      if (filters.office && e.office?.toUpperCase() !== filters.office) return false;
      if (filters.department && e.department?.toLowerCase() !== filters.department.toLowerCase()) return false;
      return true;
    });

    const allowedEmpIds = new Set(filteredEmployees.map((e) => e.id));
    const empDeptMap = new Map(filteredEmployees.map((e) => [e.id, e.department || 'General']));
    const empOfficeMap = new Map(filteredEmployees.map((e) => [e.id, (e.office || 'MUM').toUpperCase()]));

    // 2. Resolve holidays for next 90 days
    const officeCodes = Array.from(new Set(filteredEmployees.map((e) => e.office?.toUpperCase()).filter(Boolean)));
    const resolvedHolidays = await resolveHolidaysForWindow(
      supabase,
      todayStr,
      horizonEndDate,
      officeCodes.length > 0 ? officeCodes : ['MUM', 'HYD']
    );

    // 3. Fetch leave requests in next 90 days (approved & pending)
    const { data: requests, error: reqErr } = await selectAllRows<any>((from, to) =>
      (supabase
        .from('leave_requests')
        .select('id, employee_id, start_date, end_date, total_days, status')
        .or('status.eq.approved,status.eq.pending')
        .lte('start_date', horizonEndDate)
        .gte('end_date', todayStr) as any)
        .range(from, to)
    );

    if (reqErr) {
      return NextResponse.json({ error: `Failed to load requests: ${reqErr.message}` }, { status: 500 });
    }

    const validRequests = (requests ?? []).filter((r: any) => allowedEmpIds.has(r.employee_id));

    // 4. Analyze holiday clusters and bridge days
    // Collect all holidays across offices in next 90 days
    const holidaysInWindow: Array<{ date: string; name: string; office: string }> = [];
    for (const [office, hData] of resolvedHolidays.byOffice.entries()) {
      if (filters.office && office !== filters.office) continue;
      for (const h of hData.holidaysList) {
        if (h.date >= todayStr && h.date <= horizonEndDate) {
          holidaysInWindow.push(h);
        }
      }
    }

    // Deduplicate holidays by date & name
    const groupedHolidays = new Map<string, { date: string; name: string; offices: string[] }>();
    for (const h of holidaysInWindow) {
      const key = `${h.date}_${h.name}`;
      const existing = groupedHolidays.get(key) || { date: h.date, name: h.name, offices: [] };
      if (!existing.offices.includes(h.office)) existing.offices.push(h.office);
      groupedHolidays.set(key, existing);
    }

    const sortedHolidays = Array.from(groupedHolidays.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Group adjacent holidays (e.g. Diwali Mon + Tue) or separate ones
    const opportunities: PlannerOpportunity[] = [];

    for (const h of sortedHolidays) {
      const dow = getUTCDayOfWeek(h.date); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
      const holidayDates = [h.date];
      let bridgeDates: string[] = [];
      let type: PlannerOpportunity['type'] = 'long_weekend';
      let title = `${h.name} Long Weekend`;
      let totalOpportunityDays = 3;

      if (dow === 1) {
        // Monday holiday: Weekend (Sat, Sun) + Monday = 3 days
        title = `${h.name} Extended Weekend (Sat–Mon)`;
        totalOpportunityDays = 3;
        type = 'long_weekend';
      } else if (dow === 5) {
        // Friday holiday: Friday + Weekend (Sat, Sun) = 3 days
        title = `${h.name} Extended Weekend (Fri–Sun)`;
        totalOpportunityDays = 3;
        type = 'long_weekend';
      } else if (dow === 4) {
        // Thursday holiday: Friday is a bridge day to the weekend!
        const friDate = addDays(h.date, 1);
        bridgeDates.push(friDate);
        title = `${h.name} Bridge Opportunity (Thu holiday + Fri bridge)`;
        totalOpportunityDays = 4; // Thu, Fri, Sat, Sun
        type = 'bridge_day';
      } else if (dow === 2) {
        // Tuesday holiday: Monday is a bridge day from the weekend!
        const monDate = addDays(h.date, -1);
        bridgeDates.push(monDate);
        title = `${h.name} Bridge Opportunity (Mon bridge + Tue holiday)`;
        totalOpportunityDays = 4; // Sat, Sun, Mon, Tue
        type = 'bridge_day';
      } else if (dow === 3) {
        // Wednesday holiday: standalone or multi-day break
        title = `${h.name} Mid-Week Break`;
        totalOpportunityDays = 1;
        type = 'multi_day_holiday';
      } else {
        // Weekend holiday
        title = `${h.name} (Falls on Weekend)`;
        totalOpportunityDays = 2;
        type = 'long_weekend';
      }

      // Check which employees have approved or pending leave on any of these holiday or bridge dates
      const targetDates = new Set([...holidayDates, ...bridgeDates]);
      const approvedEmpSet = new Set<string>();
      const pendingEmpSet = new Set<string>();
      const deptCounts = new Map<string, { approved: number; pending: number }>();

      for (const req of validRequests) {
        // Check if request overlaps any target date
        let overlaps = false;
        let cur = req.start_date;
        while (cur <= req.end_date) {
          if (targetDates.has(cur)) {
            overlaps = true;
            break;
          }
          cur = addDays(cur, 1);
        }

        if (overlaps) {
          const dept = empDeptMap.get(req.employee_id) || 'General';
          const existing = deptCounts.get(dept) || { approved: 0, pending: 0 };

          if (req.status === 'approved') {
            approvedEmpSet.add(req.employee_id);
            existing.approved++;
          } else if (req.status === 'pending') {
            pendingEmpSet.add(req.employee_id);
            existing.pending++;
          }
          deptCounts.set(dept, existing);
        }
      }

      const departmentBreakdown = Array.from(deptCounts.entries())
        .map(([dept, c]) => ({
          department: dept,
          approved: c.approved,
          pending: c.pending,
        }))
        .sort((a, b) => b.approved + b.pending - (a.approved + a.pending));

      opportunities.push({
        id: `opp_${h.date}_${h.name.replace(/\s+/g, '_')}`,
        title,
        type,
        holidayName: h.name,
        holidayDates,
        bridgeDates,
        totalOpportunityDays,
        offices: h.offices,
        approvedEmployeesCount: approvedEmpSet.size,
        pendingEmployeesCount: pendingEmpSet.size,
        totalLeaveCount: approvedEmpSet.size + pendingEmpSet.size,
        departmentBreakdown,
      });
    }

    return NextResponse.json({
      horizonDays: 90,
      today: todayStr,
      horizonEndDate,
      totalOpportunities: opportunities.length,
      opportunities,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown server error';
    console.error('Planner analytics error:', err);
    return NextResponse.json({ error: `Failed to compute planner analytics: ${msg}` }, { status: 500 });
  }
}
