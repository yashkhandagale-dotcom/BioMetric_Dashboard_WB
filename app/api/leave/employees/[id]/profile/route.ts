import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
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
            'id, employee_code, full_name, email, role, department, office, employment_status, date_of_joining, notice_period_days, team_id, reporting_tech_lead_id, reporting_manager_id'
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
    // employee/tech_lead: effective manager is derived from team_id ->
    // teams.manager_id (never employees.reporting_manager_id — see
    // supabase-leave/006_teams_and_hierarchy.sql). manager: shows the
    // team(s) they manage plus who THEY report to.
    let teamName: string | null = null;
    let effectiveManagerName: string | null = null;
    let techLeadName: string | null = null;
    let reportingManagerName: string | null = null;
    let managedTeams: { id: string; name: string }[] = [];

    if (employee.role === 'employee' || employee.role === 'tech_lead') {
      if (employee.team_id) {
        const { data: team } = await supabase
          .from('teams')
          .select('name, manager_id')
          .eq('id', employee.team_id)
          .maybeSingle();
        teamName = team?.name ?? null;
        if (team?.manager_id) {
          const { data: mgr } = await supabase
            .from('employees')
            .select('full_name')
            .eq('id', team.manager_id)
            .maybeSingle();
          effectiveManagerName = mgr?.full_name ?? null;
        }
      }
      if (employee.role === 'employee' && employee.reporting_tech_lead_id) {
        const { data: tl } = await supabase
          .from('employees')
          .select('full_name')
          .eq('id', employee.reporting_tech_lead_id)
          .maybeSingle();
        techLeadName = tl?.full_name ?? null;
      }
    } else if (employee.role === 'manager') {
      const { data: teams } = await supabase.from('teams').select('id, name').eq('manager_id', employee.id);
      managedTeams = teams ?? [];
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
        teamId: employee.team_id,
        teamName,
        effectiveManagerName,
        techLeadId: employee.reporting_tech_lead_id,
        techLeadName,
        reportingManagerId: employee.reporting_manager_id,
        reportingManagerName,
        managedTeams,
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
  const {
    role,
    employment_status,
    team_id,
    reporting_tech_lead_id,
    reporting_manager_id,
    managed_team_ids, // string[] — only meaningful when role (new or existing) === 'manager'
  } = body;

  // Need the CURRENT role to know which hierarchy fields are even valid
  // to apply, since `role` in the request may be unchanged. Also used
  // below to clear out fields that don't apply to the resolved role.
  const { data: existing, error: existingError } = await supabase
    .from('employees')
    .select('id, role')
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

  if (employment_status !== undefined) {
    if (!STATUSES.includes(employment_status)) {
      return NextResponse.json({ error: `Invalid status "${employment_status}".` }, { status: 400 });
    }
    update.employment_status = employment_status;
  }

  // ── Hierarchy fields, gated by the RESOLVED role ──────────────────────
  // employee: team_id (required-ish) + reporting_tech_lead_id (from any
  //   tech_lead, company-wide — not team-filtered, by design).
  // tech_lead: team_id only. No tech lead of their own, no manager field
  //   (their manager is derived from their team).
  // manager: no team_id, no reporting_tech_lead_id. Instead
  //   reporting_manager_id (must be another employee with role=manager)
  //   and managed_team_ids (this manager's teams — can be several).
  // hr / hr_super_admin: none of the above apply; all cleared.
  if (resolvedRole === 'employee' || resolvedRole === 'tech_lead') {
    if (team_id !== undefined) {
      if (team_id) {
        const { data: team, error: teamErr } = await supabase.from('teams').select('id').eq('id', team_id).maybeSingle();
        if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 400 });
        if (!team) return NextResponse.json({ error: 'Selected team does not exist.' }, { status: 400 });
      }
      update.team_id = team_id || null;
    }
    // Not applicable to these roles — always cleared, regardless of what
    // was sent, so a stale value from before a role change can't linger.
    update.reporting_manager_id = null;

    if (resolvedRole === 'employee') {
      if (reporting_tech_lead_id !== undefined) {
        if (reporting_tech_lead_id === id) {
          return NextResponse.json({ error: 'An employee cannot report to themself.' }, { status: 400 });
        }
        if (reporting_tech_lead_id) {
          const { data: tl, error: tlErr } = await supabase
            .from('employees')
            .select('id, role')
            .eq('id', reporting_tech_lead_id)
            .maybeSingle();
          if (tlErr) return NextResponse.json({ error: tlErr.message }, { status: 400 });
          if (!tl || tl.role !== 'tech_lead') {
            return NextResponse.json({ error: 'Reporting Tech Lead must be an employee with role = tech_lead.' }, { status: 400 });
          }
        }
        update.reporting_tech_lead_id = reporting_tech_lead_id || null;
      }
    } else {
      // tech_lead: doesn't have one of their own
      update.reporting_tech_lead_id = null;
    }
  } else if (resolvedRole === 'manager') {
    update.team_id = null;
    update.reporting_tech_lead_id = null;

    if (reporting_manager_id !== undefined) {
      if (reporting_manager_id === id) {
        return NextResponse.json({ error: 'A manager cannot report to themself.' }, { status: 400 });
      }
      if (reporting_manager_id) {
        const { data: mgr, error: mgrErr } = await supabase
          .from('employees')
          .select('id, role')
          .eq('id', reporting_manager_id)
          .maybeSingle();
        if (mgrErr) return NextResponse.json({ error: mgrErr.message }, { status: 400 });
        if (!mgr || mgr.role !== 'manager') {
          return NextResponse.json({ error: 'A manager can only report to another employee with role = manager.' }, { status: 400 });
        }
      }
      update.reporting_manager_id = reporting_manager_id || null;
    }
  } else {
    // hr / hr_super_admin
    update.team_id = null;
    update.reporting_tech_lead_id = null;
    update.reporting_manager_id = null;
  }

  if (Object.keys(update).length === 1 && managed_team_ids === undefined) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('employees')
    .update(update)
    .eq('id', id)
    .select('id, role, employment_status, team_id, reporting_tech_lead_id, reporting_manager_id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  // ── Sync which teams this manager manages ─────────────────────────────
  // This is the "auto-updated everywhere" step: reassigning teams.manager_id
  // here is the ONLY write that changes who a team's employees resolve to
  // as their effective manager (see GET above and app/leave/admin/page.tsx) —
  // there's nothing to update per-employee. Uses the service client since
  // this can touch teams the current session didn't create.
  if (resolvedRole === 'manager' && Array.isArray(managed_team_ids)) {
    const service = createLeaveServiceClient();
    const desired = new Set<string>(managed_team_ids);

    const { data: currentlyManaged, error: curErr } = await service.from('teams').select('id').eq('manager_id', id);
    if (curErr) {
      return NextResponse.json({ error: `Saved, but could not read current teams: ${curErr.message}`, employee: data }, { status: 207 });
    }
    const currentIds = new Set((currentlyManaged ?? []).map((t) => t.id));

    const toAdd = [...desired].filter((tid) => !currentIds.has(tid));
    const toRemove = [...currentIds].filter((tid) => !desired.has(tid));

    if (toAdd.length > 0) {
      const { error: addErr } = await service.from('teams').update({ manager_id: id, updated_at: new Date().toISOString() }).in('id', toAdd);
      if (addErr) {
        return NextResponse.json({ error: `Saved, but failed to assign some teams: ${addErr.message}`, employee: data }, { status: 207 });
      }
    }
    if (toRemove.length > 0) {
      const { error: removeErr } = await service
        .from('teams')
        .update({ manager_id: null, updated_at: new Date().toISOString() })
        .in('id', toRemove);
      if (removeErr) {
        return NextResponse.json({ error: `Saved, but failed to unassign some teams: ${removeErr.message}`, employee: data }, { status: 207 });
      }
    }
  }

  return NextResponse.json({ employee: data });
}