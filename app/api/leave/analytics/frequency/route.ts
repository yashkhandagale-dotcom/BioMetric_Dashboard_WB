import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { selectAllRows } from '@/lib/attendanceExceptions';
import { requireHrAccess } from '@/lib/leaveSupabase/leaveAnalytics/auth';
import { parseAnalyticsFilters } from '@/lib/leaveSupabase/leaveAnalytics/filters';
import {
  FREQUENT_SPELLS_90D,
  SHORT_SPELL_MAX_DAYS,
  NO_RECENT_LEAVE_DAYS,
  BRADFORD_BANDS,
  getBradfordBand,
} from '@/lib/leaveSupabase/leaveAnalytics/constants';
import { addDays, calendarDaysDiff } from '@/lib/leaveSupabase/leaveAnalytics/calendar';
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
  date_of_joining: string | null;
  date_of_exit: string | null;
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

  const typesParam = req.nextUrl.searchParams.get('types') || req.nextUrl.searchParams.get('leave_type');
  const selectedTypes = typesParam
    ? typesParam
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
    : undefined;

  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const trailing90Start = addDays(todayStr, -90);
    const trailing52WeeksStart = addDays(todayStr, -365);
    const noLeaveCutoff = addDays(todayStr, -NO_RECENT_LEAVE_DAYS);

    // 1. Fetch non-deleted employees
    const { data: allEmployees, error: empErr } = await selectAllRows<EmployeeRow>((from, to) =>
      (supabase
        .from('employees')
        .select('id, full_name, employee_code, department, office, employment_status, date_of_joining, date_of_exit, is_deleted')
        .eq('is_deleted', false) as any)
        .range(from, to)
    );

    if (empErr) {
      return NextResponse.json({ error: `Failed to load employees: ${empErr.message}` }, { status: 500 });
    }

    const filteredEmployees = (allEmployees ?? []).filter((e) => {
      if (filters.office && e.office?.toUpperCase() !== filters.office) return false;
      if (filters.department && e.department?.toLowerCase() !== filters.department.toLowerCase()) return false;
      if (filters.employmentStatuses && !filters.employmentStatuses.includes(e.employment_status as any)) return false;
      return true;
    });

    const allowedEmpIds = new Set(filteredEmployees.map((e) => e.id));

    // 2. Resolve holidays for past 400 days to today
    const officeCodes = Array.from(new Set(filteredEmployees.map((e) => e.office?.toUpperCase()).filter(Boolean)));
    const resolvedHolidays = await resolveHolidaysForWindow(
      supabase,
      trailing52WeeksStart,
      todayStr,
      officeCodes.length > 0 ? officeCodes : ['MUM', 'HYD']
    );

    const holidayMapByOffice = new Map<string, Set<string>>();
    for (const [code, hData] of resolvedHolidays.byOffice.entries()) {
      holidayMapByOffice.set(code, hData.holidayDates);
    }

    // 3. Fetch all leave requests in the trailing 400 days window
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
        .gte('start_date', addDays(trailing52WeeksStart, -14))
        .lte('start_date', todayStr) as any)
        .range(from, to)
    );

    if (reqErr) {
      return NextResponse.json({ error: `Failed to load leave requests: ${reqErr.message}` }, { status: 500 });
    }

    // Filter to analyzed employees
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

    // Apply type filter if user selected specific types
    const spells = selectedTypes
      ? allSpells.filter((s) => Object.keys(s.typeMix).some((t) => selectedTypes.includes(t)))
      : allSpells;

    // Group spells by employee
    const spellsByEmployee = new Map<string, LeaveSpell[]>();
    for (const s of spells) {
      const list = spellsByEmployee.get(s.employeeId) || [];
      list.push(s);
      spellsByEmployee.set(s.employeeId, list);
    }

    // Build trailing 6 calendar month keys for sparklines
    const sparklineMonths: string[] = [];
    const [tY, tM] = todayStr.split('-').map(Number);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(tY, tM - 1 - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      sparklineMonths.push(key);
    }

    interface FrequentEmployeeRecord {
      employeeId: string;
      employeeName: string;
      employeeCode: string;
      department: string;
      office: string;
      spellsIn90Days: number;
      shortSpellsIn90Days: number;
      totalDaysIn90Days: number;
      avgSpellLength90Days: number;
      spellsIn52Weeks: number;
      totalDaysIn52Weeks: number;
      bradfordScore: number;
      bradfordBand: {
        key: string;
        label: string;
        description: string;
      };
      isFrequent: boolean;
      lastLeaveDate: string | null;
      typeMix: Record<string, number>;
      monthlySparkline: Array<{ month: string; days: number }>;
    }

    const employeeRecords: FrequentEmployeeRecord[] = [];
    const noRecentLeaveEmployees: Array<{
      employeeId: string;
      employeeName: string;
      employeeCode: string;
      department: string;
      office: string;
      dateOfJoining: string | null;
      tenureDays: number;
      lastLeaveDate: string | null;
      daysSinceLastLeave: number | null;
    }> = [];

    const activeStatuses = ['active', 'probation', 'notice_period'];

    for (const emp of filteredEmployees) {
      const empSpells = spellsByEmployee.get(emp.id) || [];

      // Sort spells chronologically
      empSpells.sort((a, b) => a.startDate.localeCompare(b.startDate));

      // Spells in trailing 90 days
      const spells90 = empSpells.filter((s) => s.startDate >= trailing90Start && s.startDate <= todayStr);
      const spellsIn90Days = spells90.length;
      const shortSpellsIn90Days = spells90.filter((s) => s.leaveDays <= SHORT_SPELL_MAX_DAYS).length;
      const totalDaysIn90Days = Math.round(spells90.reduce((acc, s) => acc + s.leaveDays, 0) * 10) / 10;
      const avgSpellLength90Days =
        spellsIn90Days > 0 ? Math.round((totalDaysIn90Days / spellsIn90Days) * 10) / 10 : 0;

      // Spells in trailing 52 weeks (Bradford Factor calculation)
      const spells52 = empSpells.filter(
        (s) => s.startDate >= trailing52WeeksStart && s.startDate <= todayStr
      );
      const S = spells52.length;
      const D = Math.round(spells52.reduce((acc, s) => acc + s.leaveDays, 0) * 10) / 10;
      const bradfordScore = Math.round(S * S * D);
      const bradfordBand = getBradfordBand(bradfordScore);

      // Type mix across trailing 90 days (or 52 weeks if 90 days empty)
      const mixTarget = spells90.length > 0 ? spells90 : spells52;
      const typeMix: Record<string, number> = {};
      for (const s of mixTarget) {
        for (const [code, days] of Object.entries(s.typeMix)) {
          typeMix[code] = Math.round(((typeMix[code] || 0) + days) * 10) / 10;
        }
      }

      // Last leave date
      const lastSpell = empSpells[empSpells.length - 1];
      const lastLeaveDate = lastSpell ? lastSpell.endDate : null;

      // Sparkline (days per month over trailing 6 months)
      const sparkMap = new Map<string, number>();
      for (const m of sparklineMonths) sparkMap.set(m, 0);

      for (const s of spells52) {
        for (const d of s.dayDetails) {
          const mKey = d.date.slice(0, 7);
          if (sparkMap.has(mKey)) {
            sparkMap.set(mKey, (sparkMap.get(mKey) || 0) + d.weight);
          }
        }
      }

      const monthlySparkline = sparklineMonths.map((m) => ({
        month: m,
        days: Math.round((sparkMap.get(m) || 0) * 10) / 10,
      }));

      const isFrequent = spellsIn90Days >= FREQUENT_SPELLS_90D;

      // Include in frequency list if they have at least 1 spell in trailing 52 weeks
      if (S > 0) {
        employeeRecords.push({
          employeeId: emp.id,
          employeeName: emp.full_name,
          employeeCode: emp.employee_code,
          department: emp.department,
          office: emp.office,
          spellsIn90Days,
          shortSpellsIn90Days,
          totalDaysIn90Days,
          avgSpellLength90Days,
          spellsIn52Weeks: S,
          totalDaysIn52Weeks: D,
          bradfordScore,
          bradfordBand,
          isFrequent,
          lastLeaveDate,
          typeMix,
          monthlySparkline,
        });
      }

      // ── Opposite Signal: "No Recent Leave" ────────────────────────────────
      // Active employee with tenure > NO_RECENT_LEAVE_DAYS (180d) and no approved leave in last 180 days
      if (activeStatuses.includes(emp.employment_status)) {
        const doj = emp.date_of_joining;
        const tenureDays = doj ? calendarDaysDiff(doj, todayStr) : 0;

        if (tenureDays >= NO_RECENT_LEAVE_DAYS) {
          // Check if any leave in trailing 180 days
          const hasLeaveIn180d = empSpells.some((s) => s.endDate >= noLeaveCutoff);
          if (!hasLeaveIn180d) {
            const daysSinceLastLeave = lastLeaveDate ? calendarDaysDiff(lastLeaveDate, todayStr) : null;
            noRecentLeaveEmployees.push({
              employeeId: emp.id,
              employeeName: emp.full_name,
              employeeCode: emp.employee_code,
              department: emp.department,
              office: emp.office,
              dateOfJoining: doj,
              tenureDays,
              lastLeaveDate,
              daysSinceLastLeave,
            });
          }
        }
      }
    }

    // Sort frequency table: frequent flagged first, then highest Bradford score
    employeeRecords.sort((a, b) => {
      if (a.isFrequent !== b.isFrequent) return a.isFrequent ? -1 : 1;
      return b.bradfordScore - a.bradfordScore;
    });

    // Sort no-recent-leave table by days since last leave (descending)
    noRecentLeaveEmployees.sort((a, b) => {
      const aVal = a.daysSinceLastLeave ?? a.tenureDays;
      const bVal = b.daysSinceLastLeave ?? b.tenureDays;
      return bVal - aVal;
    });

    const frequentCount = employeeRecords.filter((e) => e.isFrequent).length;
    const highBradfordCount = employeeRecords.filter(
      (e) => e.bradfordBand.key === 'high' || e.bradfordBand.key === 'critical'
    ).length;

    return NextResponse.json({
      fyStartYear: filters.fyStartYear,
      thresholds: {
        frequentSpells90D: FREQUENT_SPELLS_90D,
        shortSpellMaxDays: SHORT_SPELL_MAX_DAYS,
        noRecentLeaveDays: NO_RECENT_LEAVE_DAYS,
        bradfordBands: BRADFORD_BANDS,
      },
      summary: {
        totalEmployeesAnalyzed: filteredEmployees.length,
        employeesWithLeave: employeeRecords.length,
        frequentLeaveEmployeesCount: frequentCount,
        highBradfordEmployeesCount: highBradfordCount,
        noRecentLeaveEmployeesCount: noRecentLeaveEmployees.length,
      },
      employees: employeeRecords,
      noRecentLeaveEmployees,
      fairUseDisclaimer:
        'The Bradford Factor and Frequent Leave metrics serve as automated review triggers for supportive HR inquiry and workload assessment, never as sole disciplinary verdicts.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown server error';
    console.error('Frequency analytics error:', err);
    return NextResponse.json({ error: `Failed to compute frequency analytics: ${msg}` }, { status: 500 });
  }
}
