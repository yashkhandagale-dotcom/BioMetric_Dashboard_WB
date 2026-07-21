import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { createServiceClient as createDashboardServiceClient } from '@/lib/supabase/server';

// Used by AddEmployeeForm to populate the "Reporting Tech Lead" / "Reporting
// Manager" dropdowns via GET /api/leave/employees?role=tech_lead|manager.
// This was previously missing here (only POST existed), which made the
// dropdown fetch 405.
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

  // Employee identity between Leave Tracker and the main dashboard is
  // reconciled by employee_code (see lib/leaveSync.ts). If this code
  // doesn't exist on the dashboard side yet, sync will silently have
  // nothing to attach to later — surface that now rather than let it
  // fail silently the first time HR records leave for this person.
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
    warning = 'Could not verify this employee_code against the attendance dashboard (lookup failed).';
  }

  return NextResponse.json({ employee, warning }, { status: 201 });
}