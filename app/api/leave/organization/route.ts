import { NextRequest, NextResponse } from 'next/server';
import { createLeaveClient, createLeaveServiceClient } from '@/lib/leaveSupabase/server';
import { getDepartmentsWithManagers, getReportingHierarchy, getOrgTree } from '@/lib/leaveSupabase/organization';

// Backs the new "Organization Management" admin page — a department-first
// view of the same assignment data AdjustBalanceButton already edits
// per-employee. No new tables, no new hierarchy model: this reads/writes
// `department_managers` and `employees.reporting_lead_id` /
// `employees.reporting_manager_id`, exactly what already exists.
//
// No `teams` concept — see lib/attendanceExceptions.ts's header comment.

export async function GET() {
  try {
    const supabase = await createLeaveClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const [
      { departments, error: deptError },
      { hierarchy, error: hierError },
      { data: allManagers, error: mgrListError },
      { data: allEmployeesForReporting, error: allEmpError },
      { roots: orgTree, unassignedCount, error: treeError },
    ] = await Promise.all([
      getDepartmentsWithManagers(supabase),
      getReportingHierarchy(supabase),
      supabase.from('employees').select('id, employee_code, full_name').eq('role', 'manager').order('full_name'),
      // Deliberately not filtered by role — a manager's "reports to" can
      // be any existing employee (e.g. a CEO/CTO who isn't itself
      // role='manager' in this system). See the note in
      // app/api/leave/employees/[id]/profile/route.ts for why this was
      // relaxed from manager-only.
      supabase.from('employees').select('id, employee_code, full_name, role').order('full_name'),
      getOrgTree(supabase),
    ]);

    if (deptError || hierError || mgrListError || allEmpError || treeError) {
      return NextResponse.json(
        { error: deptError || hierError || mgrListError?.message || allEmpError?.message || treeError },
        { status: 400 }
      );
    }

    return NextResponse.json({
      departments,
      managers: hierarchy?.managers ?? [],
      leads: hierarchy?.leads ?? [],
      managerOptions: allManagers ?? [],
      reportingTargetOptions: allEmployeesForReporting ?? [],
      orgTree,
      orgTreeUnassignedCount: unassignedCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to load organization data: ${message}` }, { status: 500 });
  }
}

type AssignBody =
  | { action: 'assign_department_manager'; department: string; manager_id: string | null }
  | { action: 'assign_manager_reporting'; manager_id: string; reporting_manager_id: string | null }
  | { action: 'bulk_assign_lead'; department: string; lead_id: string | null };

export async function POST(req: NextRequest) {
  const supabase = await createLeaveClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = (await req.json()) as AssignBody;
  const service = createLeaveServiceClient();

  if (body.action === 'assign_department_manager') {
    const { department, manager_id } = body;
    if (!department) {
      return NextResponse.json({ error: 'department is required' }, { status: 400 });
    }
    if (manager_id) {
      const { data: mgr } = await service.from('employees').select('id, role').eq('id', manager_id).maybeSingle();
      if (!mgr || mgr.role !== 'manager') {
        return NextResponse.json({ error: 'Only an employee with role = manager can be assigned to a department.' }, { status: 400 });
      }
    }
    const { error } = await service
      .from('department_managers')
      .upsert({ department, manager_id, updated_at: new Date().toISOString() }, { onConflict: 'department' });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'assign_manager_reporting') {
    const { manager_id, reporting_manager_id } = body;
    if (!manager_id) {
      return NextResponse.json({ error: 'manager_id is required' }, { status: 400 });
    }
    if (reporting_manager_id === manager_id) {
      return NextResponse.json({ error: 'A manager cannot report to themself.' }, { status: 400 });
    }
    if (reporting_manager_id) {
      // Any existing employee is a valid reporting target — see the
      // matching note in the profile route for why this isn't
      // restricted to role='manager' anymore.
      const { data: mgr } = await service.from('employees').select('id').eq('id', reporting_manager_id).maybeSingle();
      if (!mgr) {
        return NextResponse.json({ error: 'Selected reporting-to employee was not found.' }, { status: 400 });
      }
      // Circular-hierarchy guard — same walk-the-chain check as
      // app/api/leave/employees/[id]/profile/route.ts's PATCH handler,
      // duplicated here (rather than shared) only because this endpoint
      // is department/manager-list-first, not single-employee-first —
      // the underlying rule is identical: `manager_id` must not already
      // appear above `reporting_manager_id` in the chain.
      let cursor: string | null = reporting_manager_id;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === manager_id) {
          return NextResponse.json(
            { error: 'This assignment would create a circular reporting chain.' },
            { status: 400 }
          );
        }
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const { data: next }: { data: { reporting_manager_id: string | null } | null } = await service
          .from('employees')
          .select('reporting_manager_id')
          .eq('id', cursor)
          .maybeSingle();
        cursor = next?.reporting_manager_id ?? null;
      }
    }
    const { error } = await service
      .from('employees')
      .update({ reporting_manager_id, updated_at: new Date().toISOString() })
      .eq('id', manager_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'bulk_assign_lead') {
    const { department, lead_id } = body;
    if (!department) {
      return NextResponse.json({ error: 'department is required' }, { status: 400 });
    }
    if (lead_id) {
      const { data: tl } = await service.from('employees').select('id, role').eq('id', lead_id).maybeSingle();
      if (!tl || tl.role !== 'lead') {
        return NextResponse.json({ error: 'Only an employee with role = lead can be assigned.' }, { status: 400 });
      }
    }
    // Applies to every current `employee`-role member of the department —
    // mirrors the single-employee PATCH's own reporting_lead_id
    // write, just fanned out. lead / manager / hr rows in the
    // department are untouched (they don't have this field — see the
    // profile PATCH's role-gating comment).
    const { error } = await service
      .from('employees')
      .update({ reporting_lead_id: lead_id, updated_at: new Date().toISOString() })
      .eq('department', department)
      .eq('role', 'employee');
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}