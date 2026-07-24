import { useEffect, useState } from 'react';
import { AttendanceRecord } from './types';
import { createClient } from './supabase/client';

// ── In-memory directory ───────────────────────────────────────────────────────
// POST-DB-MERGE (see PROGRESS.md / unified_schema.sql): this now reads and
// writes the real `employees` table directly — the same table the Leave
// Tracker's onboarding creates rows in — instead of a separate
// dashboard-only override table. There is exactly one department value per
// employee now, not "CSV value unless overridden": `employees.department`
// IS the department, full stop, and always wins over whatever a CSV upload
// says (see applyEmployeeDirectory below).
//
// Employee codes are confirmed globally unique (not per-office) in this
// org's real data, so the directory is keyed by employee_code alone now —
// no office needed for lookup.
//
// Writes are UPDATEs, not upserts: rows can only be created via Leave
// Tracker onboarding (or Sprint 4's planned CSV auto-creation) now that
// `employees` requires role/office/full_name that the dashboard doesn't
// know how to fill in. If an UPDATE matches zero rows, that means this
// employee_code hasn't been onboarded into the Leave Tracker yet — surfaced
// as an explicit error rather than silently creating a partial row.

interface DirectoryEntry {
  department: string;
  isDeleted: boolean;
  office: string;
  employeeName: string;
}

let directory = new Map<string, DirectoryEntry>();
let customDepartments: string[] = [];
let loaded = false;

// ── Result type for every function that talks to Supabase ────────────────────
// Every read/write below returns one of these instead of throwing or silently
// swallowing errors, so callers (EmployeePanel, SettingsPanel, page.tsx) can
// surface `error` via the app's existing toast mechanism. Writes only update
// local state after Supabase confirms success — see PROGRESS.md Sprint 2.
export interface StoreResult {
  success: boolean;
  error?: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();
function notify() { listeners.forEach((l) => l()); }

/** Subscribes to any directory change (load, reassign, delete, restore, new custom dept). */
export function subscribeEmployeeDirectory(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook — call in any component whose derived data depends on the directory
 *  (department pills, employee lists) so it re-renders when the directory changes. */
export function useEmployeeDirectorySync(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeEmployeeDirectory(() => setVersion((v) => v + 1)), []);
  return version;
}

export function isEmployeeDirectoryLoaded(): boolean {
  return loaded;
}

// ── Load once at app start ────────────────────────────────────────────────────
export async function loadEmployeeDirectory(): Promise<StoreResult> {
  const supabase = createClient();
  const [{ data: emps, error: empsError }, { data: depts, error: deptsError }] = await Promise.all([
    supabase.from('employees').select('employee_code, full_name, department, office, is_deleted'),
    supabase.from('custom_departments').select('name'),
  ]);

  if (empsError || deptsError) {
    // Don't set `loaded = true` and don't touch the existing directory/cache —
    // leave whatever was last successfully loaded (or the empty initial state)
    // in place rather than silently presenting a blank directory.
    const message = [empsError?.message, deptsError?.message].filter(Boolean).join('; ');
    return { success: false, error: `Could not load the employee directory: ${message}` };
  }

  directory = new Map(
    (emps ?? []).map((e) => [
      e.employee_code as string,
      {
        department: e.department as string,
        isDeleted: !!e.is_deleted,
        office: e.office as string,
        employeeName: e.full_name as string,
      },
    ])
  );
  customDepartments = (depts ?? []).map((d) => d.name as string);
  loaded = true;
  notify();
  return { success: true };
}

// ── Department reassignment ───────────────────────────────────────────────────
// employeeName/officeCode params kept for call-site compatibility (unchanged
// EmployeePanel.tsx / SettingsPanel.tsx signatures) but are no longer written
// anywhere — office/full_name are Leave Tracker-owned fields now, the
// dashboard only ever updates `department` here.
export async function setEmployeeDepartment(
  employeeCode: string,
  _officeCode: string,
  department: string,
  _employeeName?: string
): Promise<StoreResult> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('employees')
    .update({ department, updated_at: new Date().toISOString() })
    .eq('employee_code', employeeCode)
    .select('employee_code, full_name, office, is_deleted');

  if (error) {
    return { success: false, error: `Could not save the department change: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return {
      success: false,
      error: `${employeeCode} hasn't been onboarded in the Leave Tracker yet — add them there first, then reassign their department here.`,
    };
  }

  const row = data[0];
  directory.set(employeeCode, {
    department,
    isDeleted: !!row.is_deleted,
    office: row.office as string,
    employeeName: row.full_name as string,
  });
  notify();
  return { success: true };
}

export function getEmployeeDepartment(employeeCode: string): string | null {
  return directory.get(employeeCode)?.department ?? null;
}

// ── Delete / restore ──────────────────────────────────────────────────────────
// A deleted employee is dropped from every record pool at read-time (see
// applyEmployeeDirectory below) — even if a future CSV upload still lists them.
export async function deleteEmployee(employeeCode: string, _officeCode: string, _employeeName?: string): Promise<StoreResult> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('employees')
    .update({ is_deleted: true, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('employee_code', employeeCode)
    .select('employee_code, full_name, department, office');

  if (error) {
    return { success: false, error: `Could not delete employee: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return { success: false, error: `${employeeCode} was not found in the employee directory.` };
  }

  const row = data[0];
  directory.set(employeeCode, {
    department: row.department as string,
    isDeleted: true,
    office: row.office as string,
    employeeName: row.full_name as string,
  });
  notify();
  return { success: true };
}

export async function restoreEmployee(employeeCode: string, _officeCode?: string): Promise<StoreResult> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('employees')
    .update({ is_deleted: false, deleted_at: null, updated_at: new Date().toISOString() })
    .eq('employee_code', employeeCode)
    .select('employee_code, full_name, department, office');

  if (error) {
    return { success: false, error: `Could not restore employee: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return { success: false, error: `${employeeCode} was not found in the employee directory.` };
  }

  const row = data[0];
  directory.set(employeeCode, {
    department: row.department as string,
    isDeleted: false,
    office: row.office as string,
    employeeName: row.full_name as string,
  });
  notify();
  return { success: true };
}

export function isEmployeeDeleted(employeeCode: string, _officeCode?: string): boolean {
  return directory.get(employeeCode)?.isDeleted ?? false;
}

/** For a "Deleted Employees" restore list — sourced from the directory itself,
 *  since deleted employees are filtered out of every record-derived list. */
export function getDeletedEmployees(): { employeeCode: string; employeeName?: string; officeCode: string }[] {
  return Array.from(directory.entries())
    .filter(([, e]) => e.isDeleted)
    .map(([employeeCode, e]) => ({ employeeCode, employeeName: e.employeeName, officeCode: e.office }));
}

// ── Custom (HR-created) departments ───────────────────────────────────────────
// `duplicate: true` is the existing inline-validation case (name already
// exists) — SettingsPanel still shows that next to the input, unchanged.
// `success: false` with an `error` is a genuine write failure and should be
// toasted, same as every other function here.
export interface AddDepartmentResult {
  success: boolean;
  duplicate?: boolean;
  error?: string;
}

export async function addDepartment(name: string, existingDepartments: string[]): Promise<AddDepartmentResult> {
  const trimmed = name.trim();
  if (!trimmed) return { success: false };
  const all = [...existingDepartments, ...customDepartments];
  if (all.some((d) => d.toLowerCase() === trimmed.toLowerCase())) return { success: false, duplicate: true };

  const supabase = createClient();
  const { error } = await supabase.from('custom_departments').insert({ name: trimmed });

  if (error) {
    return { success: false, error: `Could not add department: ${error.message}` };
  }

  customDepartments = [...customDepartments, trimmed];
  notify();
  return { success: true };
}

// ── CSV auto-onboarding (Sprint 4's previously-planned feature) ──────────────
// Called from lib/storage.ts:saveRecords() right after an attendance CSV is
// saved. This is an INSERT ... ON CONFLICT (employee_code) DO NOTHING —
// deliberately NOT an upsert-with-update:
//   - New employee_code in the CSV -> row is created with safe defaults
//     (role: 'employee', employment_status: 'active') so they immediately
//     show up in the Leave Tracker and start accruing leave.
//   - employee_code that's already onboarded -> completely untouched. Their
//     role, email, reporting lines, and any HR-set department stay exactly
//     as-is. This matches the existing rule in applyEmployeeDirectory():
//     employees.department always wins over the CSV, never the other way
//     around. If we overwrote department here on every upload, a dashboard
//     department reassignment would get silently reverted by the next
//     biometric CSV import.
export interface EnsureEmployeesResult extends StoreResult {
  created: number;
}

export async function ensureEmployeesFromAttendance(
  records: AttendanceRecord[]
): Promise<EnsureEmployeesResult> {
  if (records.length === 0) return { success: true, created: 0 };

  // One row per employee_code — first sighting in the batch wins if the same
  // employee appears on multiple CSV rows (they will, once per day).
  const seen = new Map<string, { employeeName: string; department: string; officeCode: string }>();
  for (const r of records) {
    if (!seen.has(r.employeeCode)) {
      seen.set(r.employeeCode, {
        employeeName: r.employeeName,
        department: r.department,
        officeCode: r.officeCode,
      });
    }
  }

  const rows = Array.from(seen.entries()).map(([employeeCode, e]) => ({
    employee_code: employeeCode,
    full_name: e.employeeName,
    department: e.department,
    office: e.officeCode,
    role: 'employee', // safe default — check constraint requires one of a fixed set; HR can promote later
    // employment_status defaults to 'active' at the DB level; is_deleted defaults to false.
  }));

  const supabase = createClient();
  const { data, error } = await supabase
    .from('employees')
    .upsert(rows, { onConflict: 'employee_code', ignoreDuplicates: true })
    .select('employee_code');

  if (error) {
    return { success: false, created: 0, error: `Could not auto-onboard employees from CSV: ${error.message}` };
  }

  const created = data?.length ?? 0;
  if (created > 0) {
    // Refresh the directory so the newly-created rows are immediately visible
    // (department pills, "known departments" list, etc.) without a page reload.
    await loadEmployeeDirectory();
  }

  return { success: true, created };
}

/** Union of departments seen in uploaded records + HR-created + in-use directory entries. */
export function getAllKnownDepartments(records: AttendanceRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) if (r.department) set.add(r.department);
  for (const d of customDepartments) set.add(d);
  for (const e of directory.values()) if (e.department) set.add(e.department);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ── Applied at read-time by lib/storage.ts:getRecords() ──────────────────────
// `employees.department` is now the single source of truth (not an optional
// override) — it always wins over whatever a CSV upload says, whenever the
// employee_code is known to the directory at all.
export function applyEmployeeDirectory(records: AttendanceRecord[]): AttendanceRecord[] {
  if (directory.size === 0) return records;
  const next: AttendanceRecord[] = [];
  for (const r of records) {
    const entry = directory.get(r.employeeCode);
    if (entry?.isDeleted) continue; // dropped everywhere — KPIs, charts, tables, exports
    if (entry && entry.department !== r.department) {
      next.push({ ...r, department: entry.department });
    } else {
      next.push(r);
    }
  }
  return next;
}