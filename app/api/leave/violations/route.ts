import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';

// D4-1..D4-4: every violation here is *derived*, not stored — there is no
// violations table (matches the Sprint Tracker's own framing: "the policy
// engine already computes these signals — just not surfaced anywhere").
// That also means resolving a violation has to mean actually changing the
// real data until the condition that produced it stops being true, not
// flipping a "resolved" flag next to it — see the POST handler and the
// per-type notes below for how each category is (or isn't) resolvable.
//
// Optional ?employee_id= scopes everything to one employee — used by
// EmployeeModal's Violations tab; without it, this returns every open
// violation, which is what both the Violations dashboard and the
// Employee Overview grid's per-card badge counts use.

export type ViolationType =
  | 'lwp_conversion'
  | 'missing_certificate'
  | 'early_probation_pl'
  | 'negative_balance';

type Violation = {
  id: string;
  type: ViolationType;
  severity: 'high' | 'medium';
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  summary: string;
  detail: string;
  occurredOn: string;
  leaveRequestId?: string;
  leaveBalanceId?: string;
  leaveTypeCode?: string;
};

type EmployeeRow = { id: string; full_name: string; employee_code: string; date_of_joining: string };

function addMonths(dateStr: string, months: number): Date {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export async function GET(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const employeeIdFilter = req.nextUrl.searchParams.get('employee_id') || undefined;

  try {
    const violations: Violation[] = [];

    // ---------------------------------------------------------------
    // D4-1: notice-shortfall / insufficient-balance LWP conversions.
    // Trace: leave_requests.is_lwp_override = true (set at recording
    // time — see the D4-1 fix in app/api/leave/employees/requests/route.ts).
    // Not individually "resolvable": the system already did the correct
    // thing (converted to LWP instead of over-drawing a capped balance),
    // this is a review/awareness signal, not an open problem.
    // ---------------------------------------------------------------
    let lwpQuery = supabase
      .from('leave_requests')
      .select(
        `
        id, start_date, end_date, total_days, lwp_override_reason, applied_on,
        employees ( id, full_name, employee_code ),
        leave_types ( code )
      `
      )
      .eq('is_lwp_override', true);
    if (employeeIdFilter) lwpQuery = lwpQuery.eq('employee_id', employeeIdFilter);
    const { data: lwpRows, error: lwpError } = await lwpQuery;
    if (lwpError) return NextResponse.json({ error: lwpError.message }, { status: 400 });

    for (const r of lwpRows ?? []) {
      const emp = (r as any).employees;
      if (!emp) continue;
      violations.push({
        id: `lwp:${r.id}`,
        type: 'lwp_conversion',
        severity: 'medium',
        employeeId: emp.id,
        employeeName: emp.full_name,
        employeeCode: emp.employee_code,
        summary: `${r.total_days} day(s) converted to LWP`,
        detail: r.lwp_override_reason || 'Converted to LWP at recording time.',
        occurredOn: r.start_date,
        leaveRequestId: r.id,
      });
    }

    // ---------------------------------------------------------------
    // D4-2: missing medical certificate. Trace: an approved SL
    // leave_requests row longer than leave_types.requires_certificate_
    // after_days with medical_certificate_url still null. Resolvable:
    // POST below sets medical_certificate_url once HR has it on file,
    // which is the actual condition being checked — so it stops
    // appearing the moment it's genuinely fixed, not just dismissed.
    // ---------------------------------------------------------------
    const { data: slType, error: slTypeError } = await supabase
      .from('leave_types')
      .select('id, requires_certificate_after_days')
      .eq('code', 'SL')
      .single();
    if (slTypeError) return NextResponse.json({ error: slTypeError.message }, { status: 400 });

    if (slType.requires_certificate_after_days != null) {
      let certQuery = supabase
        .from('leave_requests')
        .select(
          `
          id, start_date, end_date, total_days, applied_on,
          employees ( id, full_name, employee_code )
        `
        )
        .eq('leave_type_id', slType.id)
        .eq('is_half_day', false)
        .eq('status', 'approved')
        .is('medical_certificate_url', null)
        .gt('total_days', slType.requires_certificate_after_days);
      if (employeeIdFilter) certQuery = certQuery.eq('employee_id', employeeIdFilter);
      const { data: certRows, error: certError } = await certQuery;
      if (certError) return NextResponse.json({ error: certError.message }, { status: 400 });

      for (const r of certRows ?? []) {
        const emp = (r as any).employees;
        if (!emp) continue;
        violations.push({
          id: `cert:${r.id}`,
          type: 'missing_certificate',
          severity: 'high',
          employeeId: emp.id,
          employeeName: emp.full_name,
          employeeCode: emp.employee_code,
          summary: `${r.total_days}-day SL (${r.start_date} → ${r.end_date}) missing a medical certificate`,
          detail: `Handbook requires a certificate beyond ${slType.requires_certificate_after_days} consecutive SL days.`,
          occurredOn: r.start_date,
          leaveRequestId: r.id,
          leaveTypeCode: 'SL',
        });
      }
    }

    // ---------------------------------------------------------------
    // D4-3: probation-period PL taken before the month-4 unlock. Trace:
    // a PL leave_requests row whose start_date falls before
    // employees.date_of_joining + 4 months (fn_apply_probation_month_
    // accrual withholds PL accrual entirely until month 4). Resolvable
    // via Adjust Balance if HR decides to correct it (deep link below);
    // otherwise it's a record HR reviews and may knowingly accept.
    // ---------------------------------------------------------------
    let plQuery = supabase
      .from('leave_requests')
      .select(
        `
        id, start_date, end_date, total_days, applied_on,
        employees ( id, full_name, employee_code, date_of_joining ),
        leave_types ( code )
      `
      )
      .eq('status', 'approved');
    if (employeeIdFilter) plQuery = plQuery.eq('employee_id', employeeIdFilter);
    const { data: plCandidateRows, error: plError } = await plQuery;
    if (plError) return NextResponse.json({ error: plError.message }, { status: 400 });

    for (const r of plCandidateRows ?? []) {
      const emp = (r as any).employees as EmployeeRow | null;
      const lt = (r as any).leave_types as { code: string } | null;
      if (!emp || !lt || lt.code !== 'PL') continue;
      const unlockDate = addMonths(emp.date_of_joining, 4);
      const startDate = new Date(`${r.start_date}T00:00:00Z`);
      if (startDate < unlockDate) {
        violations.push({
          id: `probation:${r.id}`,
          type: 'early_probation_pl',
          severity: 'high',
          employeeId: emp.id,
          employeeName: emp.full_name,
          employeeCode: emp.employee_code,
          summary: `PL taken on ${r.start_date}, before probation month-4 unlock`,
          detail: `Joined ${emp.date_of_joining} — PL doesn't unlock until ${unlockDate.toISOString().slice(0, 10)}.`,
          occurredOn: r.start_date,
          leaveRequestId: r.id,
          leaveTypeCode: 'PL',
        });
      }
    }

    // ---------------------------------------------------------------
    // D4-4: negative / over-drawn balances. Trace: a leave_balances row
    // for a directly-applicable type (SL/CL/PL — LWP is an uncapped
    // running tally by design, see schema.sql, and is excluded) with
    // closing_balance < 0. fn_debit_leave_on_approval already refuses to
    // push this negative on the leave-recording path, so in practice
    // this only happens via a manual_adjustment correction that
    // overshot — which is exactly what Adjust Balance can correct back.
    // ---------------------------------------------------------------
    let balQuery = supabase
      .from('leave_balances')
      .select(
        `
        id, closing_balance, fy_start_year,
        employees ( id, full_name, employee_code ),
        leave_types ( code, is_directly_applicable )
      `
      )
      .lt('closing_balance', 0);
    if (employeeIdFilter) balQuery = balQuery.eq('employee_id', employeeIdFilter);
    const { data: balRows, error: balError } = await balQuery;
    if (balError) return NextResponse.json({ error: balError.message }, { status: 400 });

    for (const r of balRows ?? []) {
      const emp = (r as any).employees;
      const lt = (r as any).leave_types as { code: string; is_directly_applicable: boolean } | null;
      if (!emp || !lt || !lt.is_directly_applicable) continue;
      violations.push({
        id: `balance:${r.id}`,
        type: 'negative_balance',
        severity: 'high',
        employeeId: emp.id,
        employeeName: emp.full_name,
        employeeCode: emp.employee_code,
        summary: `${lt.code} balance is ${r.closing_balance} (FY${r.fy_start_year})`,
        detail: `${lt.code} is a capped entitlement and should never go below zero — likely an over-applied manual adjustment.`,
        occurredOn: new Date().toISOString().slice(0, 10),
        leaveBalanceId: r.id,
        leaveTypeCode: lt.code,
      });
    }

    violations.sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1));

    return NextResponse.json({ violations });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to compute violations: ${message}` }, { status: 500 });
  }
}

// D4-5: one-click Resolve. Only "missing_certificate" has a real fix
// that lives here (set medical_certificate_url so the underlying
// condition is actually gone) — negative_balance and early_probation_pl
// resolve through the existing Adjust Balance flow instead (see
// AdjustBalanceButton.tsx, reused as-is on both the violations page and
// EmployeeModal), and lwp_conversion isn't resolvable by design (see
// the GET handler's comment above).
export async function POST(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json();
  const { leave_request_id, medical_certificate_url } = body as {
    leave_request_id?: string;
    medical_certificate_url?: string;
  };

  if (!leave_request_id || !medical_certificate_url || !medical_certificate_url.trim()) {
    return NextResponse.json(
      { error: 'leave_request_id and a non-empty medical_certificate_url are required' },
      { status: 400 }
    );
  }

  const service = createLeaveServiceClient();
  const { data: updated, error } = await service
    .from('leave_requests')
    .update({ medical_certificate_url: medical_certificate_url.trim() })
    .eq('id', leave_request_id)
    .select('id, medical_certificate_url')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  }

  return NextResponse.json({ leave_request: updated });
}