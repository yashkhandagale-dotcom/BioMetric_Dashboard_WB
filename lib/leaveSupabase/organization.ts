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

export type TechLeadSummary = {
  id: string;
  employeeCode: string;
  fullName: string;
  managedEmployeeCount: number;
};

export type ReportingHierarchy = {
  managers: ManagerSummary[];
  techLeads: TechLeadSummary[];
};

export async function getReportingHierarchy(
  supabase: SupabaseClient
): Promise<{ hierarchy: ReportingHierarchy | null; error: string | null }> {
  const [
    { data: managerRows, error: managerError },
    { data: techLeadRows, error: techLeadError },
    { data: deptManagers, error: deptError },
    { data: allEmployees, error: allError },
    { data: reportingTargets, error: targetsError },
  ] = await Promise.all([
    supabase.from('employees').select('id, employee_code, full_name, reporting_manager_id').eq('role', 'manager'),
    supabase.from('employees').select('id, employee_code, full_name').eq('role', 'tech_lead'),
    supabase.from('department_managers').select('department, manager_id'),
    supabase.from('employees').select('id, reporting_tech_lead_id').eq('role', 'employee'),
    // reporting_manager_id can point at any employee now (not just
    // role=manager — see the profile route's note on why), so resolving
    // its display name needs to look across everyone, not just the
    // manager list above.
    supabase.from('employees').select('id, full_name'),
  ]);

  const firstError = managerError || techLeadError || deptError || allError || targetsError;
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

  const techLeadCounts = new Map<string, number>();
  for (const e of allEmployees ?? []) {
    if (!e.reporting_tech_lead_id) continue;
    techLeadCounts.set(e.reporting_tech_lead_id, (techLeadCounts.get(e.reporting_tech_lead_id) ?? 0) + 1);
  }

  const techLeads: TechLeadSummary[] = (techLeadRows ?? []).map((t) => ({
    id: t.id,
    employeeCode: t.employee_code,
    fullName: t.full_name,
    managedEmployeeCount: techLeadCounts.get(t.id) ?? 0,
  }));

  return { hierarchy: { managers, techLeads }, error: null };
}