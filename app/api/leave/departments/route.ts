import { NextResponse } from 'next/server';
import { createLeaveClient } from '@/lib/leaveSupabase/server';

// Backs the "Departments Managed" checklist in AdjustBalanceButton's and
// AddEmployeeForm's Details tab. Replaces the old /api/leave/teams route,
// which queried a `teams` table that was never actually migrated (see
// supabase-leave/schema.sql's 006_department_managers.sql comment).
//
// Departments aren't a separate catalog here — they're whatever values
// exist in employees.department (set at CSV onboarding, per
// lib/employeeStore.ts). So GET derives the distinct list from employees
// itself, then left-joins each against department_managers for its
// current manager (id + name), so the UI can show
// "Engineering — managed by Aditi Rao" without a second round trip.
// There is no POST here — a department can't be "created" independent
// of an employee row that already carries it.
export async function GET() {
  try {
    const supabase = await createLeaveClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: employeeRows, error: empError } = await supabase
      .from('employees')
      .select('department')
      .order('department');
    if (empError) {
      return NextResponse.json({ error: empError.message }, { status: 400 });
    }

    const departmentNames = Array.from(
      new Set((employeeRows ?? []).map((e) => e.department).filter((d): d is string => !!d))
    ).sort((a, b) => a.localeCompare(b));

    const { data: managerRows, error: mgrError } = await supabase
      .from('department_managers')
      .select('department, manager_id');
    if (mgrError) {
      return NextResponse.json({ error: mgrError.message }, { status: 400 });
    }

    const managerIdByDept = new Map(
      (managerRows ?? []).map((r) => [r.department, r.manager_id] as const)
    );
    // A department could have a manager_id row from before its last
    // employee was reassigned/removed — still surface it if it's a
    // known department, but don't invent departments that have no
    // employees at all.
    for (const r of managerRows ?? []) {
      if (r.department && !departmentNames.includes(r.department)) {
        departmentNames.push(r.department);
      }
    }
    departmentNames.sort((a, b) => a.localeCompare(b));

    const managerIds = Array.from(
      new Set([...managerIdByDept.values()].filter((id): id is string => !!id))
    );
    let managerNames: Record<string, string> = {};
    if (managerIds.length > 0) {
      const { data: managers } = await supabase
        .from('employees')
        .select('id, full_name')
        .in('id', managerIds);
      managerNames = Object.fromEntries((managers ?? []).map((m) => [m.id, m.full_name]));
    }

    return NextResponse.json({
      departments: departmentNames.map((department) => {
        const managerId = managerIdByDept.get(department) ?? null;
        return {
          department,
          managerId,
          managerName: managerId ? managerNames[managerId] ?? null : null,
        };
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to load departments: ${message}`, departments: [] },
      { status: 500 }
    );
  }
}
