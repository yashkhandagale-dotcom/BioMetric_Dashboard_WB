export type DepartmentRow = {
  department: string;
  managerId: string | null;
  managerName: string | null;
};

export type ManagerRow = {
  id: string;
  employeeCode: string;
  fullName: string;
  managedDepartments: string[];
  reportingManagerId: string | null;
  reportingManagerName: string | null;
};

export type LeadRow = {
  id: string;
  employeeCode: string;
  fullName: string;
  managedEmployeeCount: number;
  reportingManagerId: string | null;
  reportingManagerName: string | null;
};

export type ManagerOption = {
  id: string;
  employee_code: string;
  full_name: string;
};

export type ReportingOption = {
  id: string;
  employee_code: string;
  full_name: string;
  role: string;
};

export type OrgTreeNode = {
  id: string;
  employeeCode: string;
  fullName: string;
  role: string;
  department: string | null;
  children: OrgTreeNode[];
};

export type OrgTab = 'chart' | 'departments' | 'managers' | 'leads';

export const ROLE_LABEL: Record<string, string> = {
  hr_super_admin: 'HR (Super Admin)',
  hr: 'HR',
  manager: 'Manager',
  lead: 'Lead',
  employee: 'Employee',
};

// Role-identity colors: independent of light/dark theme tokens so role recognizability stays constant
export const ROLE_COLOR: Record<string, { text: string; bg: string }> = {
  hr_super_admin: { text: '#a78bfa', bg: 'rgba(167,139,250,0.14)' },
  hr: { text: '#a78bfa', bg: 'rgba(167,139,250,0.14)' },
  manager: { text: '#60a5fa', bg: 'rgba(96,165,250,0.14)' },
  lead: { text: '#2dd4bf', bg: 'rgba(45,212,191,0.14)' },
  employee: { text: '#94a3b8', bg: 'rgba(148,163,184,0.14)' },
};

export function roleColor(role: string) {
  return ROLE_COLOR[role] ?? ROLE_COLOR.employee;
}

export function deptColor(name: string | null) {
  if (!name) return '#64748b';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 62%)`;
}

export function initials(name: string) {
  if (/^\d+$/.test(name)) return '#' + name.slice(-2);
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function countTree(nodes: OrgTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countTree(n.children), 0);
}
