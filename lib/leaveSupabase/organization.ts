import type { SupabaseClient } from '@supabase/supabase-js';

// Shared read helpers backing both app/api/leave/departments (existing,
// refactored to call getDepartmentsWithManagers below instead of
// inlining the same query) and the new Organization Management page /
// app/api/leave/organization route. Kept in one place so "which manager
// owns this department" is computed exactly once, not twice with a risk
// of the two copies drifting.
//
// No `teams` concept here by design — see lib/attendanceExceptions.ts's
// header comment for why. Department is the only grouping; "Team" in the
// original requirement doc maps onto Department everywhere in this app.

export type DepartmentWithManager = {
  department: string;
  managerId: string | null;
  managerName: string | null;
};

export async function getDepartmentsWithManagers(
  supabase: SupabaseClient
): Promise<{ departments: DepartmentWithManager[]; error: string | null }> {
  const { data: employeeRows, error: empError } = await supabase
    .from('employees')
    .select('department')
    .order('department');
  if (empError) return { departments: [], error: empError.message };

  const departmentNames = Array.from(
    new Set((employeeRows ?? []).map((e) => e.department).filter((d): d is string => !!d))
  ).sort((a, b) => a.localeCompare(b));

  const { data: managerRows, error: mgrError } = await supabase
    .from('department_managers')
    .select('department, manager_id');
  if (mgrError) return { departments: [], error: mgrError.message };

  const managerIdByDept = new Map((managerRows ?? []).map((r) => [r.department, r.manager_id] as const));
  for (const r of managerRows ?? []) {
    if (r.department && !departmentNames.includes(r.department)) {
      departmentNames.push(r.department);
    }
  }
  departmentNames.sort((a, b) => a.localeCompare(b));

  const managerIds = Array.from(new Set([...managerIdByDept.values()].filter((id): id is string => !!id)));
  let managerNames: Record<string, string> = {};
  if (managerIds.length > 0) {
    const { data: managers } = await supabase.from('employees').select('id, full_name').in('id', managerIds);
    managerNames = Object.fromEntries((managers ?? []).map((m) => [m.id, m.full_name]));
  }

  return {
    departments: departmentNames.map((department) => {
      const managerId = managerIdByDept.get(department) ?? null;
      return { department, managerId, managerName: managerId ? managerNames[managerId] ?? null : null };
    }),
    error: null,
  };
}

export type ManagerSummary = {
  id: string;
  employeeCode: string;
  fullName: string;
  managedDepartments: string[];
  reportingManagerId: string | null;
  reportingManagerName: string | null;
};

// The single lookup every manager-scoped read/write should use — approvals
// queue, the read-only /leave/team view, and the manager's filtered Team
// Dashboard all need "which employees does this manager effectively
// manage", and per the design already established on the admin grid (see
// app/leave/admin/page.tsx's `effectiveManagerId` — "the auto-updated
// everywhere hierarchy is entirely driven off department_managers"), that
// answer is: every role='employee'/'lead' member of a department this
// manager owns in `department_managers`. NOT `employees.reporting_manager_id`
// — that column is for a *manager's own* reporting chain (who they report
// to), not for who reports to them; using it for scoping was the bug that
// made a freshly-assigned department manager see an empty approval queue
// and an empty team dashboard despite the assignment existing.
export async function getManagedEmployeeIds(
  supabase: SupabaseClient,
  managerId: string
): Promise<{ employeeIds: string[]; departments: string[]; error: string | null }> {
  const { data: deptRows, error: deptError } = await supabase
    .from('department_managers')
    .select('department')
    .eq('manager_id', managerId);
  if (deptError) return { employeeIds: [], departments: [], error: deptError.message };

  const departments = (deptRows ?? []).map((d) => d.department);
  if (departments.length === 0) return { employeeIds: [], departments: [], error: null };

  const { data: empRows, error: empError } = await supabase
    .from('employees')
    .select('id')
    .in('department', departments)
    .in('role', ['employee', 'lead']);
  if (empError) return { employeeIds: [], departments, error: empError.message };

  return { employeeIds: (empRows ?? []).map((e) => e.id), departments, error: null };
}

// Resolves the ONE person who should approve/be notified about a given
// employee's leave, per the routing rule: a department's manager
// (department_managers) is the approver whenever one is assigned; a lead
// (employees.reporting_lead_id) only steps in when the employee's
// department currently has no manager. A lead is therefore optional per
// team — not every team needs one — while a manager, when present,
// always takes precedence over a lead for approval purposes.
//
// This is the single source of truth for "who approves this employee's
// leave" — app/api/leave/approvals/[id]/approve|reject and
// notifyLeaveEvent.ts both call this instead of reading
// employees.reporting_manager_id directly, which is NOT an employee's
// manager (see getManagedEmployeeIds's comment above) and was the root
// cause of managers/leads being unable to approve requests that the
// approvals queue (correctly, via department_managers) showed them.
export async function getEffectiveApproverId(
  supabase: SupabaseClient,
  employeeRow: { department: string | null; reporting_lead_id?: string | null }
): Promise<{ approverId: string | null; via: 'manager' | 'lead' | null }> {
  if (employeeRow.department) {
    const { data } = await supabase
      .from('department_managers')
      .select('manager_id')
      .eq('department', employeeRow.department)
      .maybeSingle();
    if (data?.manager_id) return { approverId: data.manager_id, via: 'manager' };
  }
  if (employeeRow.reporting_lead_id) {
    return { approverId: employeeRow.reporting_lead_id, via: 'lead' };
  }
  return { approverId: null, via: null };
}

export type LeadSummary = {
  id: string;
  employeeCode: string;
  fullName: string;
  managedEmployeeCount: number;
  reportingManagerId: string | null;
  reportingManagerName: string | null;
};

export type ReportingHierarchy = {
  managers: ManagerSummary[];
  leads: LeadSummary[];
};

export async function getReportingHierarchy(
  supabase: SupabaseClient
): Promise<{ hierarchy: ReportingHierarchy | null; error: string | null }> {
  const [
    { data: managerRows, error: managerError },
    { data: leadRows, error: leadError },
    { data: deptManagers, error: deptError },
    { data: allEmployees, error: allError },
    { data: reportingTargets, error: targetsError },
  ] = await Promise.all([
    supabase.from('employees').select('id, employee_code, full_name, reporting_manager_id').eq('role', 'manager'),
    // Leads now carry reporting_manager_id too — see the type comment
    // above and app/api/leave/employees/[id]/profile/route.ts's PATCH
    // handler, which used to unconditionally clear this on every save
    // for role='lead' regardless of what was sent, silently discarding
    // whatever this page's Leads tab had just set. getOrgTree already
    // read this field for any non-employee role, so leads were always
    // *able* to nest under a manager in the tree — nothing here was
    // ever writing (durably) or reading it back for display.
    supabase.from('employees').select('id, employee_code, full_name, reporting_manager_id').eq('role', 'lead'),
    supabase.from('department_managers').select('department, manager_id'),
    supabase.from('employees').select('id, reporting_lead_id').eq('role', 'employee'),
    // reporting_manager_id can point at any employee now (not just
    // role=manager — see the profile route's note on why), so resolving
    // its display name needs to look across everyone, not just the
    // manager list above.
    supabase.from('employees').select('id, full_name'),
  ]);

  const firstError = managerError || leadError || deptError || allError || targetsError;
  if (firstError) return { hierarchy: null, error: firstError.message };

  const departmentsByManagerId = new Map<string, string[]>();
  for (const d of deptManagers ?? []) {
    if (!d.manager_id) continue;
    const list = departmentsByManagerId.get(d.manager_id) ?? [];
    list.push(d.department);
    departmentsByManagerId.set(d.manager_id, list);
  }

  const namesById = new Map((reportingTargets ?? []).map((e) => [e.id, e.full_name]));

  const managers: ManagerSummary[] = (managerRows ?? []).map((m) => ({
    id: m.id,
    employeeCode: m.employee_code,
    fullName: m.full_name,
    managedDepartments: departmentsByManagerId.get(m.id) ?? [],
    reportingManagerId: m.reporting_manager_id,
    reportingManagerName: m.reporting_manager_id ? namesById.get(m.reporting_manager_id) ?? null : null,
  }));

  const leadCounts = new Map<string, number>();
  for (const e of allEmployees ?? []) {
    if (!e.reporting_lead_id) continue;
    leadCounts.set(e.reporting_lead_id, (leadCounts.get(e.reporting_lead_id) ?? 0) + 1);
  }

  const leads: LeadSummary[] = (leadRows ?? []).map((t) => ({
    id: t.id,
    employeeCode: t.employee_code,
    fullName: t.full_name,
    managedEmployeeCount: leadCounts.get(t.id) ?? 0,
    reportingManagerId: t.reporting_manager_id,
    reportingManagerName: t.reporting_manager_id ? namesById.get(t.reporting_manager_id) ?? null : null,
  }));

  return { hierarchy: { managers, leads }, error: null };
}

// ── Org tree ──────────────────────────────────────────────────────────────
// The flat `managers` + `leads` lists above are what the assignment tables
// on the Organization page edit (each row needs its own dropdown), but they
// don't show WHO reports to WHOM — that's why the page felt like two
// unrelated tables instead of one organization chart. This builds an actual
// nested tree instead.
//
// It deliberately does NOT hardcode "CEO / CTO / Delivery Head / Project
// Manager" as separate roles. Those titles don't need their own `role`
// value or column: `employees.role` already only needs to answer "who
// approves this person's leave" (employee → lead → manager → hr), and
// `reporting_manager_id` already accepts ANY employee as a target (see the
// note in app/api/leave/organization/route.ts's POST handler) — so a
// manager-role row can report to another manager-role row, any number of
// levels deep, which is exactly how CEO → CTO → Delivery Head → Project
// Manager → (department) Manager chains are represented here: they're all
// `role = 'manager'`, distinguished only by where they sit in the
// reporting_manager_id chain and what they're each called (full_name /
// designation), not by a separate enum value per title.
export type OrgTreeNode = {
  id: string;
  employeeCode: string;
  fullName: string;
  role: string;
  department: string | null;
  children: OrgTreeNode[];
};

export async function getOrgTree(
  supabase: SupabaseClient
): Promise<{ roots: OrgTreeNode[]; unassignedCount: number; error: string | null }> {
  const { data: rows, error } = await supabase
    .from('employees')
    .select('id, employee_code, full_name, role, department, reporting_manager_id, reporting_lead_id')
    .neq('employment_status', 'exited')
    .order('full_name');
  if (error) return { roots: [], unassignedCount: 0, error: error.message };

  // Pull department -> manager assignment so we can treat a department's
  // assigned manager as the effective parent for employees who don't
  // have an explicit reporting_lead_id set. This ensures the org chart
  // reflects department assignments (the "team" concept) even when the
  // per-employee reporting fields are unset.
  const { data: deptManagerRows } = await supabase.from('department_managers').select('department, manager_id');
  const deptManagerByDept = new Map((deptManagerRows ?? []).map((r) => [r.department, r.manager_id] as const));

  const nodesById = new Map<string, OrgTreeNode>();
  for (const r of rows ?? []) {
    nodesById.set(r.id, {
      id: r.id,
      employeeCode: r.employee_code,
      fullName: r.full_name,
      role: r.role,
      department: r.department,
      children: [],
    });
  }

  // Parent for role='employee' rows is their lead (reporting_lead_id);
  // for everyone else (lead/manager/hr) it's reporting_manager_id — an
  // employee's leave chain climbs lead → manager → hr, so the tree should
  // mirror that, not force every row through the same column.
  const roots: OrgTreeNode[] = [];
  let unassignedCount = 0;
  for (const r of rows ?? []) {
    const node = nodesById.get(r.id)!;
    // For employees prefer `reporting_lead_id`; if absent, fall back to the
    // department's assigned manager (if any) so they appear under that
    // manager in the chart. For non-employee roles use `reporting_manager_id`.
    let parentId: string | null | undefined;
    if (r.role === 'employee') {
      parentId = r.reporting_lead_id ?? deptManagerByDept.get(r.department ?? '') ?? null;
    } else {
      parentId = r.reporting_manager_id;
    }
    const parent = parentId ? nodesById.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else if (parentId && !parent) {
      // Parent id set but points at someone exited/deleted — surface as
      // its own root rather than silently dropping the employee.
      roots.push(node);
      unassignedCount += 1;
    } else if (!parentId && r.role !== 'employee') {
      roots.push(node);
    } else {
      // role='employee' with no reporting_lead_id set yet.
      roots.push(node);
      unassignedCount += 1;
    }
  }

  const sortChildren = (n: OrgTreeNode) => {
    n.children.sort((a, b) => a.fullName.localeCompare(b.fullName));
    n.children.forEach(sortChildren);
  };
  roots.sort((a, b) => a.fullName.localeCompare(b.fullName));
  roots.forEach(sortChildren);

  return { roots, unassignedCount, error: null };
}
