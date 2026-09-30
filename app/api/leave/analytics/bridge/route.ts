import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { selectAllRows } from '@/lib/attendanceExceptions';
import { requireHrAccess } from '@/lib/leaveSupabase/leaveAnalytics/auth';
import { parseAnalyticsFilters } from '@/lib/leaveSupabase/leaveAnalytics/filters';
import { MIN_SPELLS_FOR_BRIDGE_FLAG } from '@/lib/leaveSupabase/leaveAnalytics/constants';
import { calculateAttachedBaselineShare, getUTCDayOfWeek, addDays } from '@/lib/leaveSupabase/leaveAnalytics/calendar';
import { resolveHolidaysForWindow } from '@/lib/leaveSupabase/leaveAnalytics/holidays';
import {
  buildSpellsFromRequests,
  LeaveSpell,
  LeaveRequestInput,
} from '@/lib/leaveSupabase/leaveAnalytics/spells';

interface EmployeeRow {
  id: string;
  full_name: string;
  employee_code: string;
  department: string;
  office: string;
  employment_status: string;
  is_deleted: boolean;
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

  // Selected types default to SL, CL; caller may pass comma-separated types (e.g. SL,CL,PL)
  const typesParam = req.nextUrl.searchParams.get('types') || req.nextUrl.searchParams.get('leave_type');
  const selectedTypes = typesParam
    ? typesParam
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
    : ['SL', 'CL'];

  try {
    // 1. Fetch employees
    const { data: allEmployees, error: empErr } = await selectAllRows<EmployeeRow>((from, to) =>
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
    const empMap = new Map(filteredEmployees.map((e) => [e.id, e]));

    // 2. Resolve holidays for analysis window (with +/- 14 days cushion)
    const officeCodes = Array.from(new Set(filteredEmployees.map((e) => e.office?.toUpperCase()).filter(Boolean)));
    const resolvedHolidays = await resolveHolidaysForWindow(
      supabase,
      filters.startDate,
      filters.endDate,
      officeCodes.length > 0 ? officeCodes : ['MUM', 'HYD']
    );

    // Build holiday map for spells engine
    const holidayMapByOffice = new Map<string, Set<string>>();
    const holidayNamesByOffice = new Map<string, Map<string, string>>();
    for (const [code, hData] of resolvedHolidays.byOffice.entries()) {
      holidayMapByOffice.set(code, hData.holidayDates);
      holidayNamesByOffice.set(code, hData.holidayNames);
    }

    // Baseline attached share per office
    const officeBaselines = new Map<string, { totalWorkingDays: number; attachedWorkingDays: number; attachedShare: number }>();
    for (const [code, hData] of resolvedHolidays.byOffice.entries()) {
      const baseline = calculateAttachedBaselineShare(filters.startDate, filters.endDate, hData.holidayDates);
      officeBaselines.set(code, baseline);
    }

    // 3. Fetch leave requests in the window (cushioned by 14 days before and after for spell continuity)
    const windowStart = addDays(filters.startDate, -14);
    const windowEnd = addDays(filters.endDate, 14);

    const { data: rawRequests, error: reqErr } = await selectAllRows<any>((from, to) =>
      (supabase
        .from('leave_requests')
        .select(
          `
          id, employee_id, start_date, end_date, total_days, status, source, is_half_day, is_lwp_override,
          employees!leave_requests_employee_id_fkey ( id, full_name, employee_code, department, office, employment_status, is_deleted ),
          leave_types ( code, display_name )
        `
        )
        .gte('start_date', windowStart)
        .lte('start_date', windowEnd) as any)
        .range(from, to)
    );

    if (reqErr) {
      return NextResponse.json({ error: `Failed to load leave requests: ${reqErr.message}` }, { status: 500 });
    }

    // Filter requests to employees under analysis
    const validRequests: LeaveRequestInput[] = (rawRequests ?? [])
      .filter((r: any) => allowedEmpIds.has(r.employee_id))
      .map((r: any) => {
        const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees;
        const lt = Array.isArray(r.leave_types) ? r.leave_types[0] : r.leave_types;
        return {
          id: r.id,
          employee_id: r.employee_id,
          start_date: r.start_date,
          end_date: r.end_date,
          total_days: r.total_days,
          status: r.status,
          source: r.source,
          is_half_day: r.is_half_day,
          is_lwp_override: r.is_lwp_override,
          leave_type_code: lt?.code,
          leave_types: lt,
          employees: emp,
        };
      });

    // 4. Build spells across all leave types
    const allSpells = buildSpellsFromRequests(validRequests, holidayMapByOffice, {
      allowedStatuses: filters.statuses,
    });

    // 5. Filter reportable spells:
    // - Spell starts or ends within the FY
    // - Spell contains at least one day of a selected type
    const reportableSpells = allSpells.filter((spell) => {
      // Date boundary check
      if (spell.endDate < filters.startDate || spell.startDate > filters.endDate) {
        return false;
      }
      // Selected type check
      const hasSelectedType = Object.keys(spell.typeMix).some((t) => selectedTypes.includes(t));
      return hasSelectedType;
    });

    // 6. Aggregate per employee
    const spellsByEmployee = new Map<string, LeaveSpell[]>();
    for (const s of reportableSpells) {
      const list = spellsByEmployee.get(s.employeeId) || [];
      list.push(s);
      spellsByEmployee.set(s.employeeId, list);
    }

    // Weekday breakdown for attached spells
    const weekdayCounts: Record<string, number> = {
      Monday: 0,
      Tuesday: 0,
      Wednesday: 0,
      Thursday: 0,
      Friday: 0,
    };
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Holiday breakdown
    const holidayHits = new Map<string, { holidayName: string; date: string; office: string; employees: Set<string> }>();

    for (const spell of reportableSpells) {
      if (!spell.attachment.isAttached) continue;

      // Tally weekdays of working leave days in this attached spell
      for (const d of spell.dayDetails) {
        const dow = getUTCDayOfWeek(d.date);
        const name = dayNames[dow];
        if (weekdayCounts[name] !== undefined) {
          weekdayCounts[name] += d.weight;
        }
      }

      // Tally involved holidays
      for (const hDate of spell.attachment.involvedHolidayDates) {
        const hName =
          holidayNamesByOffice.get(spell.office)?.get(hDate) ||
          resolvedHolidays.byOffice.get(spell.office)?.holidayNames.get(hDate) ||
          'Office Holiday';
        const hitKey = `${spell.office}_${hDate}`;
        const existing = holidayHits.get(hitKey) || {
          holidayName: hName,
          date: hDate,
          office: spell.office,
          employees: new Set<string>(),
        };
        existing.employees.add(spell.employeeId);
        holidayHits.set(hitKey, existing);
      }
    }

    // Build employee records
    interface EmployeeBridgeReport {
      employeeId: string;
      employeeName: string;
      employeeCode: string;
      department: string;
      office: string;
      totalSpells: number;
      attachedSpells: number;
      attachedShare: number; // 0.0 - 1.0
      officeBaselineShare: number; // e.g. 0.40
      attachedRatioVsBaseline: number; // attachedShare / baselineShare (approximate)
      flaggedForReview: boolean;
      instances: Array<{
        startDate: string;
        endDate: string;
        leaveDays: number;
        extendedBreakDays: number;
        leverage: number;
        types: string;
        classification: string[];
      }>;
    }

    const employeeReports: EmployeeBridgeReport[] = [];

    for (const emp of filteredEmployees) {
      const spells = spellsByEmployee.get(emp.id) || [];
      const totalSpells = spells.length;
      const attachedSpells = spells.filter((s) => s.attachment.isAttached).length;
      const attachedShare = totalSpells > 0 ? Math.round((attachedSpells / totalSpells) * 100) / 100 : 0;
      const officeCode = (emp.office || 'MUM').toUpperCase();
      const officeBaseline = officeBaselines.get(officeCode)?.attachedShare ?? 0.4;
      const attachedRatioVsBaseline =
        officeBaseline > 0 ? Math.round((attachedShare / officeBaseline) * 100) / 100 : 1;

      // Flagged for review rule:
      // Minimum spells threshold met AND attached share significantly exceeds baseline
      const flaggedForReview =
        totalSpells >= MIN_SPELLS_FOR_BRIDGE_FLAG && attachedShare > officeBaseline;

      const instances = spells.map((s) => {
        const classification: string[] = [];
        if (s.attachment.beforeBreak) classification.push('Before Break');
        if (s.attachment.afterBreak) classification.push('After Break');
        if (s.attachment.sandwich) classification.push('Sandwich');
        if (s.attachment.holidayInvolved) classification.push('Holiday Involved');

        const typesStr = Object.entries(s.typeMix)
          .map(([t, days]) => `${days}d ${t}`)
          .join(', ');

        return {
          startDate: s.startDate,
          endDate: s.endDate,
          leaveDays: s.leaveDays,
          extendedBreakDays: s.attachment.extendedBreakDays,
          leverage: s.attachment.leverage,
          types: typesStr,
          classification,
        };
      });

      // Include employees with at least 1 spell
      if (totalSpells > 0) {
        employeeReports.push({
          employeeId: emp.id,
          employeeName: emp.full_name,
          employeeCode: emp.employee_code,
          department: emp.department,
          office: emp.office,
          totalSpells,
          attachedSpells,
          attachedShare,
          officeBaselineShare: officeBaseline,
          attachedRatioVsBaseline,
          flaggedForReview,
          instances,
        });
      }
    }

    // Sort employee reports by flagged status, then attached ratio descending
    employeeReports.sort((a, b) => {
      if (a.flaggedForReview !== b.flaggedForReview) {
        return a.flaggedForReview ? -1 : 1;
      }
      return b.attachedRatioVsBaseline - a.attachedRatioVsBaseline;
    });

    // 7. Org & Department Summaries
    const totalReportableSpells = reportableSpells.length;
    const totalAttachedSpells = reportableSpells.filter((s) => s.attachment.isAttached).length;
    const orgAttachedShare =
      totalReportableSpells > 0 ? Math.round((totalAttachedSpells / totalReportableSpells) * 100) / 100 : 0;
    const flaggedCount = employeeReports.filter((e) => e.flaggedForReview).length;

    // Department summaries
    const deptSummaryMap = new Map<
      string,
      { department: string; headcount: number; totalSpells: number; attachedSpells: number; flaggedCount: number }
    >();

    for (const emp of filteredEmployees) {
      const dept = emp.department || 'General';
      const existing = deptSummaryMap.get(dept) || {
        department: dept,
        headcount: 0,
        totalSpells: 0,
        attachedSpells: 0,
        flaggedCount: 0,
      };
      existing.headcount++;
      deptSummaryMap.set(dept, existing);
    }

    for (const er of employeeReports) {
      const entry = deptSummaryMap.get(er.department);
      if (entry) {
        entry.totalSpells += er.totalSpells;
        entry.attachedSpells += er.attachedSpells;
        if (er.flaggedForReview) entry.flaggedCount++;
      }
    }

    const departmentSummaries = Array.from(deptSummaryMap.values())
      .map((d) => ({
        ...d,
        attachedShare: d.totalSpells > 0 ? Math.round((d.attachedSpells / d.totalSpells) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.attachedShare - a.attachedShare);

    // Format weekday chart data
    const weekdayBreakdown = Object.entries(weekdayCounts).map(([day, days]) => ({
      day,
      days: Math.round(days * 10) / 10,
    }));

    // Format holiday chart data
    const holidayBreakdown = Array.from(holidayHits.values())
      .map((h) => ({
        holidayName: h.holidayName,
        date: h.date,
        office: h.office,
        employeesCount: h.employees.size,
      }))
      .sort((a, b) => b.employeesCount - a.employeesCount);

    return NextResponse.json({
      fyStartYear: filters.fyStartYear,
      selectedTypes,
      summary: {
        totalSpells: totalReportableSpells,
        attachedSpells: totalAttachedSpells,
        attachedShare: Math.round(orgAttachedShare * 1000) / 10, // percentage
        flaggedEmployeesCount: flaggedCount,
        minSpellsThreshold: MIN_SPELLS_FOR_BRIDGE_FLAG,
      },
      officeBaselines: Array.from(officeBaselines.entries()).map(([office, b]) => ({
        office,
        attachedBaselinePercent: Math.round(b.attachedShare * 1000) / 10,
      })),
      weekdayBreakdown,
      holidayBreakdown,
      departmentSummaries,
      employees: employeeReports,
      missingHolidaysWarnings: resolvedHolidays.missingWarnings,
      terminologyNote:
        'Instances meeting threshold criteria are flagged for review to facilitate proactive HR consultation, not as a conclusive verdict of policy misuse.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown server error';
    console.error('Bridge analytics error:', err);
    return NextResponse.json({ error: `Failed to compute bridge analytics: ${msg}` }, { status: 500 });
  }
}
