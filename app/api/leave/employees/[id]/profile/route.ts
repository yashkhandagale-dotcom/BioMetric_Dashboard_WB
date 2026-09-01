import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import { getEmployeeBalancesByFY } from '@/lib/leaveSupabase/getEmployeeBalances';
import { getCurrentEmployee } from '@/lib/leaveSupabase/getCurrentEmployee';

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
            'id, employee_code, full_name, email, role, department, office, employment_status, date_of_joining, notice_period_days, reporting_lead_id, reporting_manager_id'
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

    // Hierarchy resolution — mirrors app/leave/admin/page.tsx's logic so
    // this modal never disagrees with the grid about who reports to whom.
    // employee/lead: effective manager is derived from department ->
    // department_managers.manager_id (never employees.reporting_manager_id
    // — see supabase-leave/schema.sql's 006_department_managers.sql).
    // This is a separate, informational "who effectively approves this
    // person" label — independent of the literal reporting_manager_id
    // graph edge below, which is what the Org Chart tree actually walks.
    // manager: shows the department(s) they manage plus who THEY report to.
    let effectiveManagerName: string | null = null;
    let leadName: string | null = null;
    let reportingManagerName: string | null = null;
    let managedDepartments: string[] = [];

    if (employee.role === 'employee' || employee.role === 'lead') {
      if (employee.department) {
        const { data: deptMgr } = await supabase
          .from('department_managers')
          .select('manager_id')
          .eq('department', employee.department)
          .maybeSingle();
        if (deptMgr?.manager_id) {
          const { data: mgr } = await supabase
            .from('employees')
            .select('full_name')
            .eq('id', deptMgr.manager_id)
            .maybeSingle();
          effectiveManagerName = mgr?.full_name ?? null;
        }
      }
      if (employee.role === 'employee' && employee.reporting_lead_id) {
        const { data: tl } = await supabase
          .from('employees')
          .select('full_name')
          .eq('id', employee.reporting_lead_id)
          .maybeSingle();
        leadName = tl?.full_name ?? null;
      }
      // Leads can now have a real reporting_manager_id (see the PATCH
      // handler below) — resolve its display name the same way the
      // manager branch does, so the Overview tab shows "Reports to" for
      // a lead too instead of only ever showing it for managers.
      if (employee.role === 'lead' && employee.reporting_manager_id) {
        const { data: mgr } = await supabase
          .from('employees')
          .select('full_name')
          .eq('id', employee.reporting_manager_id)
          .maybeSingle();
        reportingManagerName = mgr?.full_name ?? null;
      }
    } else if (employee.role === 'manager') {
      const { data: depts } = await supabase
        .from('department_managers')
        .select('department')
        .eq('manager_id', employee.id);
      managedDepartments = (depts ?? []).map((d) => d.department);
      if (employee.reporting_manager_id) {
        const { data: mgr } = await supabase
          .from('employees')
          .select('full_name')
          .eq('id', employee.reporting_manager_id)
          .maybeSingle();
        reportingManagerName = mgr?.full_name ?? null;
      }
    }

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
        effectiveManagerName,
        leadId: employee.reporting_lead_id,
        leadName,
        reportingManagerId: employee.reporting_manager_id,
        reportingManagerName,
        managedDepartments,
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
// and reporting hierarchy (lead / manager). Department/office/full_name
// are owned by the CSV sync (lib/employeeStore.ts's ensureEmployeesFromAttendance)
// now, so this intentionally does NOT touch those — this is "Adjust" tab #2
// (Details), separate from the existing balance-adjustment tab.
const ROLES = ['employee', 'lead', 'manager', 'hr', 'hr_super_admin'];
const STATUSES = ['probation', 'active', 'notice_period', 'exited'];

// Shared by the lead + manager branches below: validates a proposed
// reporting_manager_id (self-report check + full circular-chain walk) and
// returns either the value to write or an error response. Previously this
// logic only existed inline in the manager branch — leads were routed
// around it entirely by having their reporting_manager_id hard-cleared
// instead. Kept local to this file rather than shared with
// app/api/leave/organization/route.ts's near-identical copy, same reason
// that route's own comment gives: different endpoints, low risk of drift
// for ~20 lines, not worth a shared module for.
async function resolveReportingManagerId(
  supabase: SupabaseClient,
  selfId: string,
  reportingManagerId: string | null
): Promise<{ value: string | null } | { errorResponse: NextResponse }> {
  if (!reportingManagerId) return { value: null };

  if (reportingManagerId === selfId) {
    return { errorResponse: NextResponse.json({ error: 'Cannot report to themself.' }, { status: 400 }) };
  }

  const { data: mgr, error: mgrErr } = await supabase
    .from('employees')
    .select('id')
    .eq('id', reportingManagerId)
    .maybeSingle();
  if (mgrErr) return { errorResponse: NextResponse.json({ error: mgrErr.message }, { status: 400 }) };
  if (!mgr) {
    return { errorResponse: NextResponse.json({ error: 'Selected reporting-to employee was not found.' }, { status: 400 }) };
  }

  // Circular-hierarchy guard: walk the proposed manager's existing
  // reporting_manager_id chain upward. If `selfId` appears anywhere in
  // that chain, this assignment would close a loop (e.g. A → B → C → A).
  let cursor: string | null = reportingManagerId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === selfId) {
      return {
        errorResponse: NextResponse.json(
          { error: 'This assignment would create a circular reporting chain (this employee already appears above the selected manager).' },
          { status: 400 }
        ),
      };
    }
    if (seen.has(cursor)) break; // pre-existing bad data — don't infinite-loop, just stop
    seen.add(cursor);
    const { data: next }: { data: { reporting_manager_id: string | null } | null } = await supabase
      .from('employees')
      .select('reporting_manager_id')
      .eq('id', cursor)
      .maybeSingle();
    cursor = next?.reporting_manager_id ?? null;
  }

  return { value: reportingManagerId };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // This handler can set role, employment_status, and reporting hierarchy
  // for ANY employee — HR-only, same as every other admin mutation.
  const requester = await getCurrentEmployee();
  if (!requester || (requester.role !== 'hr' && requester.role !== 'hr_super_admin')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const supabase = await createLeaveClient();

  const body = await req.json();
  const {
    role,
    employment_status,
    department,
    reporting_lead_id,
    reporting_manager_id,
    managed_departments, // string[] — only meaningful when role (new or existing) === 'manager'
  } = body;

  // Need the CURRENT role to know which hierarchy fields are even valid
  // to apply, since `role` in the request may be unchanged. Also used
  // below to clear out fields that don't apply to the resolved role.
  const { data: existing, error: existingError } = await supabase
    .from('employees')
    .select('id, role, department')
    .eq('id', id)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  const resolvedRole: string = role !== undefined ? role : existing.role;
  if (role !== undefined && !ROLES.includes(role)) {
    return NextResponse.json({ error: `Invalid role "${role}".` }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (role !== undefined) update.role = role;
  if (department !== undefined && typeof department === 'string' && department.trim()) {
    update.department = department.trim();
  }

  if (employment_status !== undefined) {
    if (!STATUSES.includes(employment_status)) {
      return NextResponse.json({ error: `Invalid status "${employment_status}".` }, { status: 400 });
    }
    update.employment_status = employment_status;
  }

  // ── Hierarchy fields, gated by the RESOLVED role ──────────────────────
  // employee: department (owned by CSV sync, not editable here) +
  //   reporting_lead_id (from any lead, company-wide — not
  //   department-filtered, by design). No reporting_manager_id of their
  //   own — employees climb the chain via their lead, not directly.
  // lead: no reporting_lead_id of their own (a lead doesn't have a lead).
  //   DOES have reporting_manager_id — who this lead reports to, using
  //   the exact same validation as a manager gets. This field used to be
  //   unconditionally nulled out here on every save regardless of what
  //   was sent, which silently discarded whatever the Organization
  //   Management page's Leads tab had just set the moment anyone opened
  //   this employee's Adjust panel and saved anything at all — even an
  //   unrelated field like employment_status. getOrgTree already reads
  //   reporting_manager_id for any non-employee role, so leads were
  //   always *able* to nest under a manager in the tree; this was the
  //   only place actively fighting that.
  // manager: no reporting_lead_id. Instead reporting_manager_id
  //   (must be another employee with role=manager) and
  //   managed_departments (this manager's departments — can be several).
  // hr / hr_super_admin: none of the above apply; all cleared.
  if (resolvedRole === 'employee') {
    update.reporting_manager_id = null;

    if (reporting_lead_id !== undefined) {
      if (reporting_lead_id === id) {
        return NextResponse.json({ error: 'An employee cannot report to themself.' }, { status: 400 });
      }
      if (reporting_lead_id) {
        const { data: tl, error: tlErr } = await supabase
          .from('employees')
          .select('id, role')
          .eq('id', reporting_lead_id)
          .maybeSingle();
        if (tlErr) return NextResponse.json({ error: tlErr.message }, { status: 400 });
        if (!tl || tl.role !== 'lead') {
          return NextResponse.json({ error: 'Reporting Lead must be an employee with role = lead.' }, { status: 400 });
        }
      }
      update.reporting_lead_id = reporting_lead_id || null;
    }
  } else if (resolvedRole === 'lead') {
    // A lead doesn't have a lead of their own.
    update.reporting_lead_id = null;

    if (reporting_manager_id !== undefined) {
      const resolved = await resolveReportingManagerId(supabase, id, reporting_manager_id || null);
      if ('errorResponse' in resolved) return resolved.errorResponse;
      update.reporting_manager_id = resolved.value;
    }
  } else if (resolvedRole === 'manager') {
    update.reporting_lead_id = null;

    if (reporting_manager_id !== undefined) {
      // Deliberately NOT restricted to role='manager'. Earlier this
      // required the reporting-to employee to also be role='manager',
      // which meant modeling a CEO/CTO at the top of the chain forced
      // inventing an extra 'manager'-role row for them even though
      // they might be hr_super_admin or any other role — adding roles
      // just to satisfy this check rather than reflecting anything
      // real. Any existing employee can be a reporting target now;
      // the only real rules are "not yourself" and "no cycle", both
      // enforced inside resolveReportingManagerId above.
      const resolved = await resolveReportingManagerId(supabase, id, reporting_manager_id || null);
      if ('errorResponse' in resolved) return resolved.errorResponse;
      update.reporting_manager_id = resolved.value;
    }
  } else {
    // hr / hr_super_admin
    update.reporting_lead_id = null;
    update.reporting_manager_id = null;
  }

  if (Object.keys(update).length === 1 && managed_departments === undefined) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('employees')
    .update(update)
    .eq('id', id)
    .select('id, role, employment_status, department, reporting_lead_id, reporting_manager_id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  // ── Sync which departments this manager manages ────────────────────────
  // This is the "auto-updated everywhere" step: reassigning a department's
  // manager_id here is the ONLY write that changes who a department's
  // employees resolve to as their effective manager (see GET above and
  // app/leave/admin/page.tsx) — there's nothing to update per-employee.
  // Uses the service client since this can touch departments the current
  // session's row-level scope didn't create.
  if (resolvedRole === 'manager' && Array.isArray(managed_departments)) {
    const service = createLeaveServiceClient();
    const desired = new Set<string>(managed_departments);

    const { data: currentlyManaged, error: curErr } = await service
      .from('department_managers')
      .select('department')
      .eq('manager_id', id);
    if (curErr) {
      return NextResponse.json({ error: `Saved, but could not read current departments: ${curErr.message}`, employee: data }, { status: 207 });
    }
    const currentDepts = new Set((currentlyManaged ?? []).map((d) => d.department));

    const toAdd = [...desired].filter((d) => !currentDepts.has(d));
    const toRemove = [...currentDepts].filter((d) => !desired.has(d));

    if (toAdd.length > 0) {
      const { error: addErr } = await service.from('department_managers').upsert(
        toAdd.map((department) => ({ department, manager_id: id, updated_at: new Date().toISOString() })),
        { onConflict: 'department' }
      );
      if (addErr) {
        return NextResponse.json({ error: `Saved, but failed to assign some departments: ${addErr.message}`, employee: data }, { status: 207 });
      }
    }
    if (toRemove.length > 0) {
      const { error: removeErr } = await service
        .from('department_managers')
        .update({ manager_id: null, updated_at: new Date().toISOString() })
        .in('department', toRemove);
      if (removeErr) {
        return NextResponse.json({ error: `Saved, but failed to unassign some departments: ${removeErr.message}`, employee: data }, { status: 207 });
      }
    }
  }

  return NextResponse.json({ employee: data });
}