import { AttendanceRecord } from './types';

// ── Employee Master Table ─────────────────────────────────────────────────
// This is the single source of truth for two things HR manages independently
// of whatever a machine's CSV says:
//
//   1. Department assignment — once HR sets it, it wins over the CSV's
//      department for that employee on every future import, forever (until
//      HR changes it again). Not just "last uploaded CSV wins".
//   2. Deletion — once HR deletes an employee, they're excluded from every
//      KPI, chart, table and export, even if a later CSV re-imports rows
//      for that same employee code.
//
// Keyed by `${employeeCode}__${officeCode}` since employee codes are only
// unique within an office (see lib/storage.ts record key).
//
// Applied at read-time only (lib/storage.ts:getRecords) — the raw CSV-derived
// data in RECORDS_PREFIX storage is never mutated, so a backup/export of raw
// data always reflects exactly what the biometric machine reported.

export interface EmployeeMasterEntry {
  employeeName: string;
  department: string;
  deleted: boolean;
  updatedAt: string; // ISO timestamp of last change (dept edit or delete/restore)
}

const KEYS = {
  CUSTOM_DEPARTMENTS: 'custom_departments',
  EMPLOYEE_MASTER: 'employee_master',
};

function masterKey(employeeCode: string, officeCode: string): string {
  return `${employeeCode}__${officeCode}`;
}

// ── Departments ───────────────────────────────────────────────────────────

export function getCustomDepartments(): string[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(KEYS.CUSTOM_DEPARTMENTS);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

/** Returns false if the department already exists (case-insensitive), true if added. */
export function addDepartment(name: string, existingDepartments: string[]): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const all = [...existingDepartments, ...getCustomDepartments()];
  if (all.some((d) => d.toLowerCase() === trimmed.toLowerCase())) return false;

  const custom = getCustomDepartments();
  custom.push(trimmed);
  localStorage.setItem(KEYS.CUSTOM_DEPARTMENTS, JSON.stringify(custom));
  return true;
}

/** Union of departments seen in uploaded records + HR-created ones, sorted, deduped. */
export function getAllKnownDepartments(records: AttendanceRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) {
    if (r.department) set.add(r.department);
  }
  for (const d of getCustomDepartments()) {
    set.add(d);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ── Employee master table (read/write) ───────────────────────────────────

export function getEmployeeMaster(): Record<string, EmployeeMasterEntry> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(KEYS.EMPLOYEE_MASTER);
  return raw ? (JSON.parse(raw) as Record<string, EmployeeMasterEntry>) : {};
}

function saveEmployeeMaster(master: Record<string, EmployeeMasterEntry>): void {
  localStorage.setItem(KEYS.EMPLOYEE_MASTER, JSON.stringify(master));
}

/** Sets the authoritative department for an employee. Wins over CSV department forever. */
export function setEmployeeDepartment(
  employeeCode: string,
  officeCode: string,
  employeeName: string,
  department: string
): void {
  const master = getEmployeeMaster();
  const key = masterKey(employeeCode, officeCode);
  const existing = master[key];
  master[key] = {
    employeeName,
    department,
    deleted: existing?.deleted ?? false,
    updatedAt: new Date().toISOString(),
  };
  saveEmployeeMaster(master);
}

export function getEmployeeDepartmentOverride(employeeCode: string, officeCode: string): string | null {
  const entry = getEmployeeMaster()[masterKey(employeeCode, officeCode)];
  return entry && !entry.deleted ? entry.department : null;
}

/** Soft delete — employee is excluded from every read (getRecords) from now on, restorable. */
export function deleteEmployee(employeeCode: string, officeCode: string, employeeName: string): void {
  const master = getEmployeeMaster();
  const key = masterKey(employeeCode, officeCode);
  const existing = master[key];
  master[key] = {
    employeeName,
    department: existing?.department ?? '',
    deleted: true,
    updatedAt: new Date().toISOString(),
  };
  saveEmployeeMaster(master);
}

export function restoreEmployee(employeeCode: string, officeCode: string): void {
  const master = getEmployeeMaster();
  const key = masterKey(employeeCode, officeCode);
  const existing = master[key];
  if (!existing) return;
  master[key] = { ...existing, deleted: false, updatedAt: new Date().toISOString() };
  saveEmployeeMaster(master);
}

export function isEmployeeDeleted(employeeCode: string, officeCode: string): boolean {
  return getEmployeeMaster()[masterKey(employeeCode, officeCode)]?.deleted ?? false;
}

/** For the Settings → Departments "Deleted Employees" restore list. */
export function getDeletedEmployees(): Array<{
  employeeCode: string;
  officeCode: string;
  employeeName: string;
  department: string;
  updatedAt: string;
}> {
  const master = getEmployeeMaster();
  return Object.entries(master)
    .filter(([, v]) => v.deleted)
    .map(([key, v]) => {
      const [employeeCode, officeCode] = key.split('__');
      return { employeeCode, officeCode, employeeName: v.employeeName, department: v.department, updatedAt: v.updatedAt };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The single choke point: filters out deleted employees and overlays the
 * authoritative department on top of raw CSV records. Called from
 * lib/storage.ts:getRecords() so every consumer (KPIs, charts, tables,
 * exports, shared links) sees the same, consistent result automatically.
 */
export function applyEmployeeMaster(records: AttendanceRecord[]): AttendanceRecord[] {
  const master = getEmployeeMaster();
  if (Object.keys(master).length === 0) return records;

  const result: AttendanceRecord[] = [];
  for (const r of records) {
    const entry = master[masterKey(r.employeeCode, r.officeCode)];
    if (entry?.deleted) continue; // excluded everywhere, even if a new CSV re-adds them
    if (entry && entry.department && entry.department !== r.department) {
      result.push({ ...r, department: entry.department });
    } else {
      result.push(r);
    }
  }
  return result;
}
