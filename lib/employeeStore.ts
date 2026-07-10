import { useEffect, useState } from 'react';
import { AttendanceRecord } from './types';
import { createClient } from './supabase/client';

// ── In-memory directory ───────────────────────────────────────────────────────
// Hydrated once from Supabase, then read synchronously by applyEmployeeDirectory()
// (called from lib/storage.ts:getRecords()). Writes go to Supabase AND update
// this cache immediately (optimistic), so every place that reads through
// getRecords() reflects a change instantly — no extra plumbing needed.

interface DirectoryEntry {
  department: string | null; // HR override; null = no override
  isDeleted: boolean;
  officeCode: string;
  employeeName?: string;
}

let directory = new Map<string, DirectoryEntry>();
let customDepartments: string[] = [];
let loaded = false;

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
export async function loadEmployeeDirectory(): Promise<void> {
  const supabase = createClient();
  const [{ data: emps }, { data: depts }] = await Promise.all([
    supabase.from('employees').select('employee_code, office_code, employee_name, department, is_deleted'),
    supabase.from('custom_departments').select('name'),
  ]);
  directory = new Map(
    (emps ?? []).map((e) => [
      e.employee_code as string,
      {
        department: e.department as string | null,
        isDeleted: !!e.is_deleted,
        officeCode: e.office_code as string,
        employeeName: e.employee_name as string | undefined,
      },
    ])
  );
  customDepartments = (depts ?? []).map((d) => d.name as string);
  loaded = true;
  notify();
}

// ── Department reassignment ───────────────────────────────────────────────────
export async function setEmployeeDepartment(
  employeeCode: string,
  officeCode: string,
  department: string,
  employeeName?: string
): Promise<void> {
  const prev = directory.get(employeeCode);
  directory.set(employeeCode, { department, isDeleted: prev?.isDeleted ?? false, officeCode, employeeName: employeeName ?? prev?.employeeName });
  notify();

  const supabase = createClient();
  await supabase.from('employees').upsert(
    { employee_code: employeeCode, office_code: officeCode, employee_name: employeeName, department, updated_at: new Date().toISOString() },
    { onConflict: 'employee_code' }
  );
}

export function getEmployeeDepartmentOverride(employeeCode: string): string | null {
  return directory.get(employeeCode)?.department ?? null;
}

export async function clearEmployeeDepartmentOverride(employeeCode: string, officeCode: string): Promise<void> {
  const prev = directory.get(employeeCode);
  directory.set(employeeCode, { department: null, isDeleted: prev?.isDeleted ?? false, officeCode, employeeName: prev?.employeeName });
  notify();

  const supabase = createClient();
  await supabase.from('employees').upsert(
    { employee_code: employeeCode, office_code: officeCode, department: null, updated_at: new Date().toISOString() },
    { onConflict: 'employee_code' }
  );
}

// ── Delete / restore ──────────────────────────────────────────────────────────
// A deleted employee is dropped from every record pool at read-time (see
// applyEmployeeDirectory below) — even if a future CSV upload still lists them.
export async function deleteEmployee(employeeCode: string, officeCode: string, employeeName?: string): Promise<void> {
  const prev = directory.get(employeeCode);
  directory.set(employeeCode, { department: prev?.department ?? null, isDeleted: true, officeCode, employeeName: employeeName ?? prev?.employeeName });
  notify();

  const supabase = createClient();
  await supabase.from('employees').upsert(
    { employee_code: employeeCode, office_code: officeCode, employee_name: employeeName, is_deleted: true, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'employee_code' }
  );
}

export async function restoreEmployee(employeeCode: string, officeCode: string): Promise<void> {
  const prev = directory.get(employeeCode);
  directory.set(employeeCode, { department: prev?.department ?? null, isDeleted: false, officeCode, employeeName: prev?.employeeName });
  notify();

  const supabase = createClient();
  await supabase.from('employees').upsert(
    { employee_code: employeeCode, office_code: officeCode, is_deleted: false, deleted_at: null, updated_at: new Date().toISOString() },
    { onConflict: 'employee_code' }
  );
}

export function isEmployeeDeleted(employeeCode: string): boolean {
  return directory.get(employeeCode)?.isDeleted ?? false;
}

/** For a "Deleted Employees" restore list — sourced from the directory itself,
 *  since deleted employees are filtered out of every record-derived list. */
export function getDeletedEmployees(): { employeeCode: string; employeeName?: string; officeCode: string }[] {
  return Array.from(directory.entries())
    .filter(([, e]) => e.isDeleted)
    .map(([employeeCode, e]) => ({ employeeCode, employeeName: e.employeeName, officeCode: e.officeCode }));
}

// ── Custom (HR-created) departments ───────────────────────────────────────────
export async function addDepartment(name: string, existingDepartments: string[]): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const all = [...existingDepartments, ...customDepartments];
  if (all.some((d) => d.toLowerCase() === trimmed.toLowerCase())) return false;

  customDepartments = [...customDepartments, trimmed];
  notify();

  const supabase = createClient();
  await supabase.from('custom_departments').insert({ name: trimmed });
  return true;
}

/** Union of departments seen in uploaded records + HR-created + in-use overrides. */
export function getAllKnownDepartments(records: AttendanceRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) if (r.department) set.add(r.department);
  for (const d of customDepartments) set.add(d);
  for (const e of directory.values()) if (e.department) set.add(e.department);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ── Applied at read-time by lib/storage.ts:getRecords() ──────────────────────
export function applyEmployeeDirectory(records: AttendanceRecord[]): AttendanceRecord[] {
  if (directory.size === 0) return records;
  const next: AttendanceRecord[] = [];
  for (const r of records) {
    const entry = directory.get(r.employeeCode);
    if (entry?.isDeleted) continue; // dropped everywhere — KPIs, charts, tables, exports
    if (entry?.department && entry.department !== r.department) {
      next.push({ ...r, department: entry.department });
    } else {
      next.push(r);
    }
  }
  return next;
}