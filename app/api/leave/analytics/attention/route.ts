import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { selectAllRows } from '@/lib/attendanceExceptions';
import { requireHrAccess } from '@/lib/leaveSupabase/leaveAnalytics/auth';
import { parseAnalyticsFilters } from '@/lib/leaveSupabase/leaveAnalytics/filters';
import {
  FREQUENT_SPELLS_90D,
  MIN_SPELLS_FOR_BRIDGE_FLAG,
  LOW_BALANCE_DAYS,
  HIGH_UNUSED_BALANCE_RATIO,
  HIGH_UNUSED_BALANCE_MIN_MONTHS_ELAPSED,
  getBradfordBand,
} from '@/lib/leaveSupabase/leaveAnalytics/constants';
import { addDays, calculateAttachedBaselineShare } from '@/lib/leaveSupabase/leaveAnalytics/calendar';
import { resolveHolidaysForWindow } from '@/lib/leaveSupabase/leaveAnalytics/holidays';
import {
  buildSpellsFromRequests,
  LeaveSpell,
  LeaveRequestInput,
} from '@/lib/leaveSupabase/leaveAnalytics/spells';

interface AttentionFlag {
  id: string;
  category: 'attached_share' | 'frequent_leave' | 'bradford' | 'low_balance' | 'high_unused' | 'missing_cert';
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
}

interface AttentionEmployeeRecord {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  flagCount: number;
  criticalCount: number;
  flags: AttentionFlag[];
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
    const trailing90Start = addDays(todayStr, -90);
    const trailing52WeeksStart = addDays(todayStr, -365);

    // Calculate months elapsed in current FY (starts on March 25)
    const [tY, tM, tD] = todayStr.split('-').map(Number);
    let monthsElapsed = (tY - filters.fyStartYear) * 12 + (tM - 3);
    if (tD < 25) monthsElapsed -= 1;
    const isNineMonthsElapsed = monthsElapsed >= HIGH_UNUSED_BALANCE_MIN_MONTHS_ELAPSED;

    // 1. Fetch employees
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

    // 2. Resolve holidays for trailing 52 weeks and current FY
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

    const officeBaselines = new Map<string, number>();
    for (const [code, hData] of resolvedHolidays.byOffice.entries()) {
      const baseline = calculateAttachedBaselineShare(filters.startDate, filters.endDate, hData.holidayDates);
      officeBaselines.set(code, baseline.attachedShare);
    }

    // 3. Fetch leave types configuration (requires_certificate_after_days)
    const { data: leaveTypesData } = await supabase
      .from('leave_types')
      .select('id, code, display_name, requires_certificate_after_days');

    const certThresholdByType = new Map<string, number>();
    for (const lt of leaveTypesData || []) {
      if (lt.requires_certificate_after_days != null && lt.requires_certificate_after_days > 0) {
        certThresholdByType.set(lt.code?.toUpperCase(), lt.requires_certificate_after_days);
      }
    }

    // 4. Fetch leave balances for current FY
    const { data: balances, error: balErr } = await selectAllRows<any>((from, to) =>
      (supabase
        .from('leave_balances')
        .select(
          `
          employee_id, opening_balance, accrued, used, manual_adjustment, closing_balance,
          leave_types ( code, display_name )
        `
        )
        .eq('fy_start_year', filters.fyStartYear) as any)
        .range(from, to)
    );

    if (balErr) {
      console.warn('Balances fetch error:', balErr.message);
    }

    // Map balances by employee and leave type
    const empBalances = new Map<string, Array<{ code: string; allocated: number; used: number; closing: number }>>();
    for (const b of balances ?? []) {
      if (!allowedEmpIds.has(b.employee_id)) continue;
      const lt = Array.isArray(b.leave_types) ? b.leave_types[0] : b.leave_types;
      const code = lt?.code?.toUpperCase() || 'UNKNOWN';
      const list = empBalances.get(b.employee_id) || [];
      const allocated = (b.opening_balance || 0) + (b.accrued || 0) + (b.manual_adjustment || 0);
      list.push({
        code,
        allocated,
        used: b.used || 0,
        closing: b.closing_balance || 0,
      });
      empBalances.set(b.employee_id, list);
    }

    // 5. Fetch leave requests (trailing 52 weeks to today, plus current FY)
    const queryStart = trailing52WeeksStart < filters.startDate ? trailing52WeeksStart : filters.startDate;
    const { data: rawRequests, error: reqErr } = await selectAllRows<any>((from, to) =>
      (supabase
        .from('leave_requests')
        .select(
          `
          id, employee_id, start_date, end_date, total_days, status, source, is_half_day, is_lwp_override, medical_certificate_url,
          employees!leave_requests_employee_id_fkey ( id, full_name, employee_code, department, office, employment_status, is_deleted ),
          leave_types ( code, display_name, requires_certificate_after_days )
        `
        )
        .gte('start_date', queryStart)
        .lte('start_date', todayStr) as any)
        .range(from, to)
    );

    if (reqErr) {
      return NextResponse.json({ error: `Failed to load leave requests: ${reqErr.message}` }, { status: 500 });
    }

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
          medical_certificate_url: r.medical_certificate_url,
          leave_type_code: lt?.code,
          leave_types: lt,
          employees: emp,
        };
      });

    // Build spells for trailing 52 weeks
    const allSpells = buildSpellsFromRequests(validRequests, holidayMapByOffice, {
      allowedStatuses: filters.statuses,
    });

    const spellsByEmployee = new Map<string, LeaveSpell[]>();
    for (const s of allSpells) {
      const list = spellsByEmployee.get(s.employeeId) || [];
      list.push(s);
      spellsByEmployee.set(s.employeeId, list);
    }

    // 6. Check flags for every employee
    const attentionList: AttentionEmployeeRecord[] = [];

    for (const emp of filteredEmployees) {
      const flags: AttentionFlag[] = [];
      const empSpells = spellsByEmployee.get(emp.id) || [];
      const officeCode = (emp.office || 'MUM').toUpperCase();
      const officeBaseline = officeBaselines.get(officeCode) ?? 0.4;

      // ── Flag 1: High Attached Share ─────────────────────────────────────────
      // Spells falling within current FY
      const fySpells = empSpells.filter(
        (s) => s.endDate >= filters.startDate && s.startDate <= filters.endDate
      );
      const attachedSpells = fySpells.filter((s) => s.attachment.isAttached).length;
      const totalSpells = fySpells.length;
      const attachedShare = totalSpells > 0 ? attachedSpells / totalSpells : 0;

      if (totalSpells >= MIN_SPELLS_FOR_BRIDGE_FLAG && attachedShare > officeBaseline) {
        flags.push({
          id: 'flag_attached_share',
          category: 'attached_share',
          severity: 'warning',
          title: 'High Weekend/Holiday Attachment',
          detail: `${attachedSpells} of ${totalSpells} spells (${Math.round(attachedShare * 100)}%) attached to breaks vs office baseline ~${Math.round(officeBaseline * 100)}%.`,
        });
      }

      // ── Flag 2: Frequent Leave in Trailing 90 Days ──────────────────────────
      const spells90 = empSpells.filter((s) => s.startDate >= trailing90Start && s.startDate <= todayStr);
      if (spells90.length >= FREQUENT_SPELLS_90D) {
        flags.push({
          id: 'flag_frequent_leave',
          category: 'frequent_leave',
          severity: 'warning',
          title: 'Frequent Absence (90D)',
          detail: `${spells90.length} distinct leave spells in trailing 90 days (threshold: ${FREQUENT_SPELLS_90D}).`,
        });
      }

      // ── Flag 3: High Bradford Band ──────────────────────────────────────────
      const spells52 = empSpells.filter(
        (s) => s.startDate >= trailing52WeeksStart && s.startDate <= todayStr
      );
      const S = spells52.length;
      const D = Math.round(spells52.reduce((acc, s) => acc + s.leaveDays, 0) * 10) / 10;
      const bradfordScore = Math.round(S * S * D);
      const band = getBradfordBand(bradfordScore);

      if (band.key === 'high' || band.key === 'critical') {
        flags.push({
          id: 'flag_bradford',
          category: 'bradford',
          severity: band.key === 'critical' ? 'critical' : 'warning',
          title: `${band.label} Bradford Factor (${bradfordScore})`,
          detail: `${S} spells & ${D} days over 52 weeks (score ${bradfordScore} falls in ${band.label} band).`,
        });
      }

      // ── Flag 4: Low Balance (SL/CL <= LOW_BALANCE_DAYS) ──────────────────────
      const balancesList = empBalances.get(emp.id) || [];
      const lowBalTypes = balancesList.filter(
        (b) => (b.code === 'SL' || b.code === 'CL') && b.closing <= LOW_BALANCE_DAYS
      );
      if (lowBalTypes.length > 0) {
        const typesStr = lowBalTypes.map((b) => `${b.code}: ${b.closing}d remaining`).join(', ');
        flags.push({
          id: 'flag_low_balance',
          category: 'low_balance',
          severity: 'warning',
          title: 'Depleted Leave Balance',
          detail: `Critical balance remaining on short leave quotas (${typesStr}).`,
        });
      }

      // ── Flag 5: High Unused Balance (closing >= 80% after 9+ months of FY) ──
      if (isNineMonthsElapsed) {
        const highUnusedTypes = balancesList.filter(
          (b) =>
            b.code !== 'LWP' &&
            b.allocated > 0 &&
            b.closing >= b.allocated * HIGH_UNUSED_BALANCE_RATIO
        );
        if (highUnusedTypes.length > 0) {
          const typesStr = highUnusedTypes
            .map((b) => `${b.code} (${b.closing}/${b.allocated}d, ${Math.round((b.closing / b.allocated) * 100)}%)`)
            .join(', ');
          flags.push({
            id: 'flag_high_unused',
            category: 'high_unused',
            severity: 'warning',
            title: 'High Unused Balance Late in FY',
            detail: `${monthsElapsed} months into FY with &ge;80% unused quota (${typesStr}). Potential forfeiture or rush risk.`,
          });
        }
      }

      // ── Flag 6: Leave Request Missing Medical Certificate ───────────────────
      const empRequests = (rawRequests ?? []).filter((r: any) => r.employee_id === emp.id && r.status === 'approved');
      const missingCertRequests: any[] = [];
      for (const req of empRequests) {
        const lt = Array.isArray(req.leave_types) ? req.leave_types[0] : req.leave_types;
        const code = lt?.code?.toUpperCase();
        const threshold = lt?.requires_certificate_after_days ?? certThresholdByType.get(code);

        if (threshold && req.total_days > threshold && !req.medical_certificate_url) {
          missingCertRequests.push({
            id: req.id,
            totalDays: req.total_days,
            threshold,
            dates: `${req.start_date} to ${req.end_date}`,
          });
        }
      }

      if (missingCertRequests.length > 0) {
        const reqStr = missingCertRequests.map((r) => `${r.totalDays}d leave on ${r.dates}`).join('; ');
        flags.push({
          id: 'flag_missing_cert',
          category: 'missing_cert',
          severity: 'critical',
          title: 'Missing Medical Certificate',
          detail: `Approved leave exceeds certificate threshold without uploaded certificate (${reqStr}).`,
        });
      }

      // If employee has any flags, add to attention list
      if (flags.length > 0) {
        const criticalCount = flags.filter((f) => f.severity === 'critical').length;
        attentionList.push({
          employeeId: emp.id,
          employeeName: emp.full_name,
          employeeCode: emp.employee_code,
          department: emp.department,
          office: emp.office,
          flagCount: flags.length,
          criticalCount,
          flags,
        });
      }
    }

    // Sort by flag count descending, then critical count descending, then employee name
    attentionList.sort((a, b) => {
      if (b.flagCount !== a.flagCount) return b.flagCount - a.flagCount;
      if (b.criticalCount !== a.criticalCount) return b.criticalCount - a.criticalCount;
      return a.employeeName.localeCompare(b.employeeName);
    });

    return NextResponse.json({
      fyStartYear: filters.fyStartYear,
      totalFlaggedEmployees: attentionList.length,
      employees: attentionList,
      historyNavigationLimitation:
        'The Leave Tracker History page (/leave/admin/history) manages employee selection via in-memory tab state rather than URL parameters. Clicking "View History" will navigate to the History page where the employee can be selected in Table view.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown server error';
    console.error('Attention analytics error:', err);
    return NextResponse.json({ error: `Failed to compute attention analytics: ${msg}` }, { status: 500 });
  }
}
