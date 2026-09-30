import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { selectAllRows } from '@/lib/attendanceExceptions';
import { requireHrAccess } from '@/lib/leaveSupabase/leaveAnalytics/auth';
import { parseAnalyticsFilters } from '@/lib/leaveSupabase/leaveAnalytics/filters';

interface EmployeeRow {
  id: string;
  department: string;
  office: string;
  employment_status: string;
  is_deleted: boolean;
}

interface LeaveRequestRow {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  total_days: number;
  status: string;
  source: string;
  is_half_day: boolean;
  is_lwp_override?: boolean;
  employees: {
    department: string;
    office: string;
    employment_status: string;
    is_deleted: boolean;
  } | {
    department: string;
    office: string;
    employment_status: string;
    is_deleted: boolean;
  }[] | null;
  leave_types: {
    code: string;
    display_name: string;
  } | {
    code: string;
    display_name: string;
  }[] | null;
}

interface LeaveBalanceRow {
  employee_id: string;
  opening_balance: number;
  accrued: number;
  used: number;
  manual_adjustment: number;
  closing_balance: number;
  leave_types: {
    code: string;
    display_name: string;
  } | {
    code: string;
    display_name: string;
  }[] | null;
  employees: {
    department: string;
    office: string;
    employment_status: string;
    is_deleted: boolean;
  } | {
    department: string;
    office: string;
    employment_status: string;
    is_deleted: boolean;
  }[] | null;
}

function getLeaveTypeCode(lt: LeaveRequestRow['leave_types']): string {
  if (!lt) return 'UNKNOWN';
  if (Array.isArray(lt)) return lt[0]?.code?.toUpperCase() || 'UNKNOWN';
  return lt.code?.toUpperCase() || 'UNKNOWN';
}

function getLeaveTypeName(lt: LeaveRequestRow['leave_types']): string {
  if (!lt) return 'Unknown';
  if (Array.isArray(lt)) return lt[0]?.display_name || lt[0]?.code || 'Unknown';
  return lt.display_name || lt.code || 'Unknown';
}

function getEmployeeDepartment(emp: LeaveRequestRow['employees']): string {
  if (!emp) return 'General';
  if (Array.isArray(emp)) return emp[0]?.department || 'General';
  return emp.department || 'General';
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
    const priorFyStartYear = filters.fyStartYear - 1;
    const priorStartDate = `${priorFyStartYear}-03-25`;
    const priorEndDate = `${priorFyStartYear + 1}-03-24`;

    // 1. Fetch all non-deleted employees for headcount & baseline calculations
    const { data: allEmployees, error: empErr } = await selectAllRows<EmployeeRow>((from, to) =>
      (supabase
        .from('employees')
        .select('id, department, office, employment_status, is_deleted')
        .eq('is_deleted', false) as any)
        .range(from, to)
    );
    if (empErr) {
      return NextResponse.json({ error: `Failed to load employees: ${empErr.message}` }, { status: 500 });
    }

    // Filter employees by office / department if specified
    const filteredEmployees = (allEmployees ?? []).filter((e) => {
      if (filters.office && e.office?.toUpperCase() !== filters.office) return false;
      if (filters.department && e.department?.toLowerCase() !== filters.department.toLowerCase()) return false;
      return true;
    });

    const activeStatuses = ['active', 'probation', 'notice_period'];
    const activeHeadcount = filteredEmployees.filter((e) => activeStatuses.includes(e.employment_status)).length;
    const allowedEmpIds = new Set(filteredEmployees.map((e) => e.id));

    // Headcount by department
    const headcountByDept = new Map<string, number>();
    for (const e of filteredEmployees) {
      if (activeStatuses.includes(e.employment_status)) {
        headcountByDept.set(e.department, (headcountByDept.get(e.department) ?? 0) + 1);
      }
    }

    // 2. Fetch current FY leave requests
    const { data: currentRequests, error: reqErr } = await selectAllRows<LeaveRequestRow>((from, to) =>
      (supabase
        .from('leave_requests')
        .select(
          `
          id, employee_id, start_date, end_date, total_days, status, source, is_half_day, is_lwp_override,
          employees!leave_requests_employee_id_fkey ( department, office, employment_status, is_deleted ),
          leave_types ( code, display_name )
        `
        )
        .gte('start_date', filters.startDate)
        .lte('start_date', filters.endDate) as any)
        .range(from, to)
    );
    if (reqErr) {
      return NextResponse.json({ error: `Failed to load leave requests: ${reqErr.message}` }, { status: 500 });
    }

    // 3. Fetch prior FY leave requests for delta KPIs and trend overlay
    const { data: priorRequests, error: priorErr } = await selectAllRows<LeaveRequestRow>((from, to) =>
      (supabase
        .from('leave_requests')
        .select(
          `
          id, employee_id, start_date, end_date, total_days, status, source, is_half_day, is_lwp_override,
          employees!leave_requests_employee_id_fkey ( department, office, employment_status, is_deleted ),
          leave_types ( code, display_name )
        `
        )
        .gte('start_date', priorStartDate)
        .lte('start_date', priorEndDate) as any)
        .range(from, to)
    );
    if (priorErr) {
      console.warn('Prior FY requests fetch warning:', priorErr.message);
    }

    // 4. Fetch leave balances for current FY (quota & utilization)
    const { data: balances, error: balErr } = await selectAllRows<LeaveBalanceRow>((from, to) =>
      (supabase
        .from('leave_balances')
        .select(
          `
          employee_id, opening_balance, accrued, used, manual_adjustment, closing_balance,
          leave_types ( code, display_name ),
          employees!leave_balances_employee_id_fkey ( department, office, employment_status, is_deleted )
        `
        )
        .eq('fy_start_year', filters.fyStartYear) as any)
        .range(from, to)
    );
    if (balErr) {
      console.warn('Leave balances fetch warning:', balErr.message);
    }

    // 5. Fetch pending requests (unfiltered by date, real-time queue)
    const { data: pendingRequests, error: pendingErr } = await supabase
      .from('leave_requests')
      .select('id, employee_id, created_at, employees!leave_requests_employee_id_fkey ( department, office )')
      .eq('status', 'pending');

    if (pendingErr) {
      console.warn('Pending requests fetch warning:', pendingErr.message);
    }

    // 6. Employees on leave today
    const todayStr = new Date().toISOString().slice(0, 10);
    const { data: todayRequests } = await supabase
      .from('leave_requests')
      .select('employee_id, employees!leave_requests_employee_id_fkey ( department, office )')
      .eq('status', 'approved')
      .lte('start_date', todayStr)
      .gte('end_date', todayStr);

    // Filter current and prior requests according to active department/office/type filters
    const filterRequest = (r: LeaveRequestRow, applyTypeFilter: boolean = true) => {
      if (!allowedEmpIds.has(r.employee_id)) return false;
      const typeCode = getLeaveTypeCode(r.leave_types);
      if (applyTypeFilter && filters.leaveTypes && !filters.leaveTypes.includes(typeCode)) return false;
      return true;
    };

    const curRows = (currentRequests ?? []).filter((r) => filterRequest(r, true));
    const priorRows = (priorRequests ?? []).filter((r) => filterRequest(r, true));

    // KPI 1: Approved leave days (filtered by status and types)
    const approvedCurRows = curRows.filter((r) => filters.statuses.includes(r.status as any));
    const approvedLeaveDays = approvedCurRows.reduce((sum, r) => sum + (r.total_days || 0), 0);

    const approvedPriorRows = priorRows.filter((r) => filters.statuses.includes(r.status as any));
    const priorApprovedLeaveDays = approvedPriorRows.reduce((sum, r) => sum + (r.total_days || 0), 0);
    const approvedDaysDiff = approvedLeaveDays - priorApprovedLeaveDays;
    const approvedDaysPctChange =
      priorApprovedLeaveDays > 0
        ? Math.round(((approvedLeaveDays - priorApprovedLeaveDays) / priorApprovedLeaveDays) * 1000) / 10
        : null;

    // KPI 2: Average days per employee (active headcount)
    const avgDaysPerEmployee =
      activeHeadcount > 0 ? Math.round((approvedLeaveDays / activeHeadcount) * 100) / 100 : 0;
    const priorAvgDaysPerEmployee =
      activeHeadcount > 0 ? Math.round((priorApprovedLeaveDays / activeHeadcount) * 100) / 100 : 0;
    const avgDaysDiff = Math.round((avgDaysPerEmployee - priorAvgDaysPerEmployee) * 100) / 100;

    // KPI 3: Pending approvals (count + age in days of oldest pending request)
    const filteredPending = (pendingRequests ?? []).filter((p: any) => {
      const emp = Array.isArray(p.employees) ? p.employees[0] : p.employees;
      if (filters.office && emp?.office?.toUpperCase() !== filters.office) return false;
      if (filters.department && emp?.department?.toLowerCase() !== filters.department.toLowerCase()) return false;
      return true;
    });
    const pendingCount = filteredPending.length;
    let oldestPendingAgeDays = 0;
    if (pendingCount > 0) {
      let oldestTime = Date.now();
      for (const p of filteredPending) {
        if (p.created_at) {
          const t = new Date(p.created_at).getTime();
          if (t < oldestTime) oldestTime = t;
        }
      }
      oldestPendingAgeDays = Math.max(0, Math.floor((Date.now() - oldestTime) / (24 * 60 * 60 * 1000)));
    }

    // KPI 4: Employees on leave today
    const filteredToday = (todayRequests ?? []).filter((t: any) => {
      const emp = Array.isArray(t.employees) ? t.employees[0] : t.employees;
      if (filters.office && emp?.office?.toUpperCase() !== filters.office) return false;
      if (filters.department && emp?.department?.toLowerCase() !== filters.department.toLowerCase()) return false;
      return true;
    });
    const onLeaveTodayCount = new Set(filteredToday.map((t) => t.employee_id)).size;

    // KPI 5: LWP days (judgment call: leave type LWP with status 'approved' or 'auto_lwp')
    const curLwpRows = (currentRequests ?? []).filter((r) => {
      if (!allowedEmpIds.has(r.employee_id)) return false;
      const isLwp = getLeaveTypeCode(r.leave_types) === 'LWP' || r.is_lwp_override;
      return isLwp && (r.status === 'approved' || r.status === 'auto_lwp');
    });
    const lwpDays = curLwpRows.reduce((sum, r) => sum + (r.total_days || 0), 0);

    const priorLwpRows = (priorRequests ?? []).filter((r) => {
      if (!allowedEmpIds.has(r.employee_id)) return false;
      const isLwp = getLeaveTypeCode(r.leave_types) === 'LWP' || r.is_lwp_override;
      return isLwp && (r.status === 'approved' || r.status === 'auto_lwp');
    });
    const priorLwpDays = priorLwpRows.reduce((sum, r) => sum + (r.total_days || 0), 0);
    const lwpDiff = lwpDays - priorLwpDays;
    const lwpPctChange =
      priorLwpDays > 0 ? Math.round(((lwpDays - priorLwpDays) / priorLwpDays) * 1000) / 10 : null;

    // ── LEAVE BY TYPE (Horizontal Bar with Quota Utilization) ────────────────
    // Aggregate balances by leave type for filtered employees
    const balanceByType = new Map<string, { allocated: number; used: number }>();
    for (const b of balances ?? []) {
      if (!allowedEmpIds.has(b.employee_id)) continue;
      const code = getLeaveTypeCode(b.leave_types);
      const existing = balanceByType.get(code) || { allocated: 0, used: 0 };
      const allocated = (b.opening_balance || 0) + (b.accrued || 0) + (b.manual_adjustment || 0);
      existing.allocated += allocated;
      existing.used += b.used || 0;
      balanceByType.set(code, existing);
    }

    // Aggregate leave days by type from approvedCurRows
    const daysByTypeMap = new Map<string, { code: string; name: string; totalDays: number }>();
    for (const r of approvedCurRows) {
      const code = getLeaveTypeCode(r.leave_types);
      const name = getLeaveTypeName(r.leave_types);
      const existing = daysByTypeMap.get(code) || { code, name, totalDays: 0 };
      existing.totalDays += r.total_days || 0;
      daysByTypeMap.set(code, existing);
    }

    // Include standard leave types even if 0 days
    const standardCodes = ['SL', 'CL', 'PL', 'LWP'];
    for (const sc of standardCodes) {
      if (!daysByTypeMap.has(sc)) {
        daysByTypeMap.set(sc, { code: sc, name: sc, totalDays: 0 });
      }
    }

    const totalDaysAcrossAllTypes = approvedLeaveDays || 1;
    const leaveByType = Array.from(daysByTypeMap.values())
      .map((item) => {
        const bal = balanceByType.get(item.code);
        const hasQuota = item.code !== 'LWP';
        const allocated = hasQuota && bal ? Math.round(bal.allocated * 10) / 10 : null;
        const used = hasQuota && bal ? Math.round(bal.used * 10) / 10 : null;
        const utilization =
          hasQuota && allocated && allocated > 0
            ? Math.min(100, Math.round(((used ?? item.totalDays) / allocated) * 1000) / 10)
            : null;

        return {
          code: item.code,
          name: item.name,
          totalDays: Math.round(item.totalDays * 10) / 10,
          shareOfTotal: Math.round((item.totalDays / totalDaysAcrossAllTypes) * 1000) / 10,
          allocated,
          used,
          utilization,
        };
      })
      .sort((a, b) => b.totalDays - a.totalDays);

    // ── MONTHLY TREND (12 FY Months Mar → Feb with Prior FY Line) ───────────
    // Build 12 calendar month keys in order: Mar YYYY -> Feb YYYY+1
    const months: Array<{
      key: string;
      label: string;
      monthNum: number;
      year: number;
      priorKey: string;
    }> = [];

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 0; i < 12; i++) {
      const monthIdx = (2 + i) % 12; // March is index 2
      const year = i < 10 ? filters.fyStartYear : filters.fyStartYear + 1;
      const priorYear = year - 1;
      const mStr = String(monthIdx + 1).padStart(2, '0');
      const key = `${year}-${mStr}`;
      const priorKey = `${priorYear}-${mStr}`;
      months.push({
        key,
        label: `${monthNames[monthIdx]} ${String(year).slice(-2)}`,
        monthNum: monthIdx + 1,
        year,
        priorKey,
      });
    }

    // Monthly aggregation (attributed to start_date month)
    const monthlyDataMap = new Map<
      string,
      {
        month: string;
        label: string;
        total: number;
        priorTotal: number;
        byType: Record<string, number>;
      }
    >();

    for (const m of months) {
      monthlyDataMap.set(m.key, {
        month: m.key,
        label: m.label,
        total: 0,
        priorTotal: 0,
        byType: { SL: 0, CL: 0, PL: 0, LWP: 0 },
      });
    }

    for (const r of approvedCurRows) {
      const mKey = r.start_date.slice(0, 7);
      const entry = monthlyDataMap.get(mKey);
      if (entry) {
        entry.total += r.total_days || 0;
        const code = getLeaveTypeCode(r.leave_types);
        entry.byType[code] = (entry.byType[code] || 0) + (r.total_days || 0);
      }
    }

    // Add prior FY totals for overlay
    for (const pr of approvedPriorRows) {
      const pMonthKey = pr.start_date.slice(0, 7);
      // Map to corresponding current FY month
      const match = months.find((m) => m.priorKey === pMonthKey);
      if (match) {
        const entry = monthlyDataMap.get(match.key);
        if (entry) {
          entry.priorTotal += pr.total_days || 0;
        }
      }
    }

    const monthlyTrend = months.map((m) => {
      const d = monthlyDataMap.get(m.key)!;
      return {
        month: d.month,
        label: d.label,
        total: Math.round(d.total * 10) / 10,
        priorTotal: Math.round(d.priorTotal * 10) / 10,
        SL: Math.round((d.byType.SL || 0) * 10) / 10,
        CL: Math.round((d.byType.CL || 0) * 10) / 10,
        PL: Math.round((d.byType.PL || 0) * 10) / 10,
        LWP: Math.round((d.byType.LWP || 0) * 10) / 10,
      };
    });

    // ── DAYS PER EMPLOYEE BY DEPARTMENT ─────────────────────────────────────
    const deptDaysMap = new Map<string, number>();
    for (const r of approvedCurRows) {
      const dept = getEmployeeDepartment(r.employees);
      deptDaysMap.set(dept, (deptDaysMap.get(dept) || 0) + (r.total_days || 0));
    }

    const allDepts = Array.from(
      new Set([...Array.from(headcountByDept.keys()), ...Array.from(deptDaysMap.keys())])
    );

    const departmentBreakdown = allDepts
      .map((department) => {
        const totalDays = Math.round((deptDaysMap.get(department) || 0) * 10) / 10;
        const headcount = headcountByDept.get(department) || 0;
        const daysPerEmployee = headcount > 0 ? Math.round((totalDays / headcount) * 10) / 10 : 0;
        return {
          department,
          totalDays,
          headcount,
          daysPerEmployee,
        };
      })
      .sort((a, b) => b.daysPerEmployee - a.daysPerEmployee);

    return NextResponse.json({
      fyStartYear: filters.fyStartYear,
      fyLabel: filters.fyLabel,
      kpis: {
        approvedLeaveDays: Math.round(approvedLeaveDays * 10) / 10,
        approvedDaysDiff: Math.round(approvedDaysDiff * 10) / 10,
        approvedDaysPctChange,
        activeHeadcount,
        avgDaysPerEmployee,
        avgDaysDiff,
        pendingApprovals: {
          count: pendingCount,
          oldestAgeDays: oldestPendingAgeDays,
        },
        onLeaveTodayCount,
        lwpDays: Math.round(lwpDays * 10) / 10,
        lwpDiff: Math.round(lwpDiff * 10) / 10,
        lwpPctChange,
      },
      leaveByType,
      monthlyTrend,
      departmentBreakdown,
      footnotes: {
        attribution: 'Multi-day leave is attributed to the calendar month of its start date.',
        lwpJudgmentCall: 'LWP days include leave type LWP with approved or auto_lwp status.',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown server error';
    console.error('Analytics overview error:', err);
    return NextResponse.json({ error: `Failed to compute overview: ${msg}` }, { status: 500 });
  }
}
