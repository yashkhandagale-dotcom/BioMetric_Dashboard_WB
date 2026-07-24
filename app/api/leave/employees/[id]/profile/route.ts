import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import { getEmployeeBalancesByFY } from '@/lib/leaveSupabase/getEmployeeBalances';

// D2-2: powers the Employee Modal's Overview / Balances / Leave Timeline
// tabs in one round trip. Balances reuse getEmployeeBalancesByFY — the
// same pivot app/leave/admin and the Employee Overview grid use — scoped
// to this one employee, so the modal can never show a number that
// disagrees with the grid or the balances table for the same person.
//
// Violations tab has nothing to fetch here yet: real violation detection
// (notice-shortfall LWP conversions, missing medical certs, probation
// leave taken early, negative balances) lands Day 4 behind
// GET /api/leave/violations, matching the placeholder already wired into
// ViolationBadge on Day 1.

type RequestRow = {
  id: string;
  start_date: string;
  end_date: string;
  is_half_day: boolean;
  half_day_session: string | null;
  total_days: number;
  status: string;
  source: string;
  is_lwp_override: boolean;
  reason: string;
  applied_on: string;
  leave_types: { code: string; display_name: string } | null;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const fyStartYear = getFYStartYear();

    const [{ data: employee, error: empError }, { rows: balanceRows, error: balError }, { data: requests, error: reqError }] =
      await Promise.all([
        supabase
          .from('employees')
          .select(
            'id, employee_code, full_name, email, role, department, office, employment_status, date_of_joining, notice_period_days'
          )
          .eq('id', id)
          .maybeSingle(),
        getEmployeeBalancesByFY(supabase, fyStartYear, id),
        supabase
          .from('leave_requests')
          .select(
            `
            id, start_date, end_date, is_half_day, half_day_session, total_days,
            status, source, is_lwp_override, reason, applied_on,
            leave_types ( code, display_name )
          `
          )
          .eq('employee_id', id)
          .order('applied_on', { ascending: false })
          .limit(15)
          .returns<RequestRow[]>(),
      ]);

    if (empError) {
      return NextResponse.json({ error: empError.message }, { status: 400 });
    }
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }
    if (balError) {
      return NextResponse.json({ error: balError.message }, { status: 400 });
    }
    if (reqError) {
      return NextResponse.json({ error: reqError.message }, { status: 400 });
    }

    const b = balanceRows[0];

    const recentRequests = (requests ?? []).map((r) => ({
      id: r.id,
      leaveTypeCode: r.leave_types?.code ?? 'UNKNOWN',
      leaveTypeLabel: r.leave_types?.display_name ?? 'Unknown',
      startDate: r.start_date,
      endDate: r.end_date,
      isHalfDay: r.is_half_day,
      halfDaySession: r.half_day_session,
      totalDays: r.total_days,
      status: r.status,
      source: r.source,
      isLwpOverride: r.is_lwp_override,
      reason: r.reason,
      appliedOn: r.applied_on,
    }));

    return NextResponse.json({
      employee: {
        id: employee.id,
        code: employee.employee_code,
        name: employee.full_name,
        email: employee.email,
        role: employee.role,
        department: employee.department,
        office: employee.office,
        employmentStatus: employee.employment_status,
        dateOfJoining: employee.date_of_joining,
        noticePeriodDays: employee.notice_period_days,
      },
      balances: {
        SL: b?.SL ?? 0,
        CL: b?.CL ?? 0,
        PL: b?.PL ?? 0,
        LWP: b?.LWP ?? 0,
      },
      fyStartYear,
      fyLabel: formatFYLabel(fyStartYear),
      recentRequests,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to load employee profile: ${message}` }, { status: 500 });
  }
}

// Updates the fields a CSV upload cannot supply — employment_status, role,
// and reporting hierarchy (tech lead / manager). Department/office/full_name
// are owned by the CSV sync (lib/employeeStore.ts's ensureEmployeesFromAttendance)
// now, so this intentionally does NOT touch those — this is "Adjust" tab #2
// (Details), separate from the existing balance-adjustment tab.
const ROLES = ['employee', 'tech_lead', 'manager', 'hr', 'hr_super_admin'];
const STATUSES = ['probation', 'active', 'notice_period', 'exited'];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json();
  const { role, employment_status, reporting_tech_lead_id, reporting_manager_id } = body;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (role !== undefined) {
    if (!ROLES.includes(role)) {
      return NextResponse.json({ error: `Invalid role "${role}".` }, { status: 400 });
    }
    update.role = role;
  }
  if (employment_status !== undefined) {
    if (!STATUSES.includes(employment_status)) {
      return NextResponse.json({ error: `Invalid status "${employment_status}".` }, { status: 400 });
    }
    update.employment_status = employment_status;
  }
  if (reporting_tech_lead_id !== undefined) {
    if (reporting_tech_lead_id === id) {
      return NextResponse.json({ error: 'An employee cannot report to themself.' }, { status: 400 });
    }
    update.reporting_tech_lead_id = reporting_tech_lead_id || null;
  }
  if (reporting_manager_id !== undefined) {
    if (reporting_manager_id === id) {
      return NextResponse.json({ error: 'An employee cannot report to themself.' }, { status: 400 });
    }
    update.reporting_manager_id = reporting_manager_id || null;
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('employees')
    .update(update)
    .eq('id', id)
    .select('id, role, employment_status, reporting_tech_lead_id, reporting_manager_id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  return NextResponse.json({ employee: data });
}