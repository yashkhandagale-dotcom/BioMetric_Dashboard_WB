import { AttendanceRecord } from './types';

// ── Departments (a.k.a. "Teams") ─────────────────────────────────────────────
// Department already IS the team grouping used throughout the app (dept pills,
// comparison mode, KPI grouping etc.) — there's no separate "Team" entity.
// This module adds two things on top of the existing CSV-derived departments:
//
//  1. HR-created departments that don't (yet) exist in any uploaded CSV, so
//     they show up as assignable options before any employee is moved into
//     them.
//  2. Per-employee department overrides — HR can move an individual employee
//     into a different department without touching the underlying CSV data.
//     This mirrors the existing leave-records overlay pattern (lib/leaveStorage.ts):
//     non-destructive, applied at read-time on top of the raw records.

const KEYS = {
  CUSTOM_DEPARTMENTS: 'custom_departments',
  DEPARTMENT_OVERRIDES: 'employee_department_overrides',
};

function overrideKey(employeeCode: string, officeCode: string): string {
  return `${employeeCode}__${officeCode}`;
}

// ── Custom (HR-created) departments ──────────────────────────────────────────

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

// ── Per-employee department overrides ────────────────────────────────────────

export function getDepartmentOverrides(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(KEYS.DEPARTMENT_OVERRIDES);
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

export function setEmployeeDepartment(
  employeeCode: string,
  officeCode: string,
  department: string
): void {
  const overrides = getDepartmentOverrides();
  overrides[overrideKey(employeeCode, officeCode)] = department;
  localStorage.setItem(KEYS.DEPARTMENT_OVERRIDES, JSON.stringify(overrides));
}

export function getEmployeeDepartmentOverride(
  employeeCode: string,
  officeCode: string
): string | null {
  const overrides = getDepartmentOverrides();
  return overrides[overrideKey(employeeCode, officeCode)] ?? null;
}

export function clearEmployeeDepartmentOverride(employeeCode: string, officeCode: string): void {
  const overrides = getDepartmentOverrides();
  delete overrides[overrideKey(employeeCode, officeCode)];
  localStorage.setItem(KEYS.DEPARTMENT_OVERRIDES, JSON.stringify(overrides));
}

/**
 * Applies any stored per-employee override on top of a record's raw CSV
 * department. Read-time overlay only — never mutates stored/backed-up data.
 */
export function applyDepartmentOverrides(records: AttendanceRecord[]): AttendanceRecord[] {
  const overrides = getDepartmentOverrides();
  if (Object.keys(overrides).length === 0) return records;

  let changed = false;
  const next = records.map((r) => {
    const override = overrides[overrideKey(r.employeeCode, r.officeCode)];
    if (override && override !== r.department) {
      changed = true;
      return { ...r, department: override };
    }
    return r;
  });
  return changed ? next : records;
}
