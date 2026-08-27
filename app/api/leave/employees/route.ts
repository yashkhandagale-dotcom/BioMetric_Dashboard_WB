import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { createServiceClient as createDashboardServiceClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

// Used by AddEmployeeForm to populate the "Reporting Lead" / "Reporting
// Manager" dropdowns via GET /api/leave/employees?role=lead|manager.
// This was previously missing here (only POST existed), which made the
// dropdown fetch 405.
//
// D2/D3: also reused, unfiltered, by components/leave/RecordLeaveForm.tsx
// (the drawer's employee search) and app/leave/admin/history/page.tsx
// (department/office filter options) — department/office were added to
// the select below for that reuse; existing callers that only read
// id/full_name/employee_code/role are unaffected.
export async function GET(req: NextRequest) {
  try {
    const sessionClient = await createLeaveClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const role = req.nextUrl.searchParams.get('role'); // 'lead' | 'manager' | null (= all)
    const withoutLogin = req.nextUrl.searchParams.get('without_login') === '1';
    let query = sessionClient
      .from('employees')
      .select('id, full_name, employee_code, role, department, office, email, auth_user_id')
      .order('full_name');
    if (role) query = query.eq('role', role);
    if (withoutLogin) query = query.is('auth_user_id', null);

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
  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
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
    reporting_lead_id,
    reporting_manager_id,
    managed_departments, // string[] — only used when role === 'manager'
    notice_period_days,
    // Simplified onboarding — see 0017_pending_signups_and_probation.sql
    // and app/leave/pending/page.tsx. When set, this employee is being
    // created as the "Acknowledge" step for someone who already signed
    // in with Google (components/leave/NewJoinersPanel.tsx) rather than
    // a bare Add Employee. See below for how that changes what happens
    // on success.
    pending_signup_id,
    // Optional per-employee override of leave_policy_config.
    // probation_unlock_months — see that column's comment in the
    // migration and lib/leaveSupabase/applyLeavePolicyAndMutateBalance.ts
    // for where it's actually read.
    probation_months,
  } = body;

  if (!employee_code || !full_name || !email || !role || !department || !office || !date_of_joining) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const service = createLeaveServiceClient();

  // If this is an Ack (pending_signup_id present), the person already
  // has a real Supabase Auth session from signing in with Google —
  // pull the auth_user_id/email straight from that row rather than
  // trusting the submitted email, so there's no way to accidentally
  // link the wrong account. must be *validated* here, not assumed
  // by the client — this route is HR-authorized, not self-service.
  let pendingAuthUserId: string | null = null;
  if (pending_signup_id) {
    const { data: pending, error: pendingFetchError } = await service
      .from('pending_employee_signups')
      .select('id, auth_user_id, email')
      .eq('id', pending_signup_id)
      .maybeSingle();
    if (pendingFetchError) {
      return NextResponse.json({ error: pendingFetchError.message }, { status: 400 });
    }
    if (!pending) {
      return NextResponse.json(
        { error: 'This sign-in is no longer pending — it may have already been acknowledged, or the person needs to sign in again.' },
        { status: 404 }
      );
    }
    pendingAuthUserId = pending.auth_user_id;
  }

  // IMPORTANT: employee_code is unique. Before inserting, always check
  // whether HR is actually trying to set up an employee that already
  // exists. A stale pending Google signup can survive after HR has added
  // the employee manually, so blindly inserting here used to produce:
  // `duplicate key value violates unique constraint
  // "employees_employee_code_key"`.
  //
  // For an acknowledgement flow, an existing employee_code means the
  // employee record already exists — link the already-authenticated Google
  // account to that record instead of creating a second employee row.
  const { data: existingByCode, error: existingCodeError } = await service
    .from('employees')
    .select('id, employee_code, full_name, email, role, auth_user_id, auth_provider')
    .eq('employee_code', employee_code)
    .maybeSingle();

  if (existingCodeError) {
    return NextResponse.json({ error: existingCodeError.message }, { status: 400 });
  }

  if (existingByCode) {
    if (!pending_signup_id) {
      return NextResponse.json(
        {
          error: `Employee code "${employee_code}" already exists for ${existingByCode.full_name || existingByCode.email || 'an employee'}. Use the existing employee record instead of adding a duplicate.`,
        },
        { status: 409 }
      );
    }

    // This is the safe HR acknowledgement path: HR is explicitly
    // acknowledging a Google identity that is waiting in the pending queue.
    // Never overwrite an existing auth link belonging to another account.
    if (existingByCode.auth_user_id && existingByCode.auth_user_id !== pendingAuthUserId) {
      return NextResponse.json(
        {
          error: `Employee code "${employee_code}" is already linked to another login. No changes were made.`,
        },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const { data: linkedEmployee, error: linkExistingError } = await service
      .from('employees')
      .update({
        auth_user_id: pendingAuthUserId,
        auth_provider: 'google',
        profile_confirmed_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', existingByCode.id)
      .select()
      .single();

    if (linkExistingError) {
      return NextResponse.json({ error: linkExistingError.message }, { status: 400 });
    }

    await service
      .from('pending_employee_signups')
      .delete()
      .eq('id', pending_signup_id);

    return NextResponse.json({
      employee: linkedEmployee,
      message: `Existing employee "${linkedEmployee.full_name}" was linked to the Google account. No duplicate employee was created.`,
    });
  }

  // Hierarchy fields are role-gated the same way the profile PATCH route
  // gates them — see app/api/leave/employees/[id]/profile/route.ts for
  // the full rationale. Grouping itself is just `department` (already
  // required above) — there is no separate team concept.
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
      reporting_lead_id: role === 'employee' ? reporting_lead_id || null : null,
      reporting_manager_id: role === 'manager' ? reporting_manager_id || null : null,
      notice_period_days: notice_period_days || 30,
      employment_status: 'probation',
      probation_months: probation_months || null,
      // Ack path: link immediately — this person already proved they
      // control this email via Google, no separate first-login linking
      // step needed. Plain Add Employee path: leave null, exactly as
      // before — that person links on their own first sign-in (see
      // app/api/auth/callback/route.ts).
      auth_user_id: pendingAuthUserId,
      auth_provider: pendingAuthUserId ? 'google' : 'password',
      profile_confirmed_at: pendingAuthUserId ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  if (pending_signup_id) {
    // Best-effort cleanup — the employee row is already created and
    // linked at this point regardless, so a failure here is surfaced as
    // a warning, not rolled back into an error.
    await service.from('pending_employee_signups').delete().eq('id', pending_signup_id);
  }

  if (role === 'manager' && Array.isArray(managed_departments) && managed_departments.length > 0) {
    const { error: deptErr } = await service
      .from('department_managers')
      .upsert(
        managed_departments.map((department: string) => ({
          department,
          manager_id: employee.id,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'department' }
      );
    if (deptErr) {
      return NextResponse.json(
        { error: `Employee created, but assigning departments failed: ${deptErr.message}`, employee },
        { status: 207 }
      );
    }
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
  // reconciled by employee_code (the main dashboard now reads leave data
  // live from this project — see app/api/dashboard/leave-records/route.ts
  // — keyed on employee_code/office). If this code doesn't exist on the
  // dashboard side yet, leave for this person just won't resolve to
  // anyone there — surface that now rather than let it be a silent gap
  // the first time HR records leave for this person.
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