import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { createServiceClient as createDashboardServiceClient } from '@/lib/supabase/server';

// Used by AddEmployeeForm to populate the "Reporting Tech Lead" / "Reporting
// Manager" dropdowns. Kept lightweight — id/name/code only.
export async function GET(req: NextRequest) {
  try {
    const sessionClient = await createLeaveClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const role = req.nextUrl.searchParams.get('role'); // 'tech_lead' | 'manager' | null (= all)
    let query = sessionClient
      .from('employees')
      .select('id, full_name, employee_code, role')
      .order('full_name');
    if (role) query = query.eq('role', role);

    const { data: employees, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ employees: employees ?? [] });
  } catch (err) {
    // Guards against e.g. missing NEXT_PUBLIC_LEAVE_SUPABASE_* env vars
    // throwing before a response is built — without this, the client sees
    // an empty body and fails on res.json() with a confusing syntax error
    // instead of a readable message.
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to load employees: ${message}`, employees: [] },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const sessionClient = await createLeaveClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json();
  const {
    employee_code,
    full_name,
    email,
    role,
    department,
    office,
    date_of_joining,
    reporting_tech_lead_id,
    reporting_manager_id,
    notice_period_days,
  } = body;

  if (!employee_code || !full_name || !email || !role || !department || !office || !date_of_joining) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const service = createLeaveServiceClient();

  const { data: employee, error: insertError } = await service
    .from('employees')
    .insert({
      employee_code,
      full_name,
      email,
      role,
      department,
      office,
      date_of_joining,
      reporting_tech_lead_id: reporting_tech_lead_id || null,
      reporting_manager_id: reporting_manager_id || null,
      notice_period_days: notice_period_days || 30,
      employment_status: 'probation',
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  const { error: prorateError } = await service.rpc('fn_prorate_new_joiner', {
    p_employee_id: employee.id,
    p_doj: date_of_joining,
  });

  if (prorateError) {
    return NextResponse.json(
      { error: `Employee created, but pro-ration failed: ${prorateError.message}`, employee },
      { status: 207 }
    );
  }

  // Cross-check against the MAIN dashboard's own Supabase project — the
  // Leave Tracker later syncs leave records over there keyed only by
  // employee_code (see lib/leaveStorage.ts), so a code that doesn't exist
  // on that side yet means sync will silently have nothing to attach to.
  // This is a warning, not a hard block: HR may legitimately be adding a
  // new joiner here before their first biometric export creates the
  // matching row on the dashboard side.
  let warning: string | undefined;
  try {
    const dashboardService = createDashboardServiceClient();
    const { data: match } = await dashboardService
      .from('employees')
      .select('employee_code')
      .eq('employee_code', employee_code)
      .maybeSingle();

    if (!match) {
      warning =
        `No employee with code "${employee_code}" was found in the attendance ` +
        `dashboard yet. Leave records for this person won't show up there until ` +
        `a matching biometric record exists — double-check the code once one does.`;
    }
  } catch {
    // Dashboard project env vars missing/unreachable — don't block employee
    // creation on this being available.
    warning = 'Could not verify this employee_code against the attendance dashboard (lookup failed).';
  }

  return NextResponse.json({ employee, warning }, { status: 201 });
}