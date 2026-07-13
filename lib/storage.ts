import { AttendanceRecord, ColumnMapping, UploadedMonth } from './types';
import { applyEmployeeDirectory } from './employeeStore';
import { createClient } from './supabase/client';
import { normalizeDate } from './parseCSV';

// ═══════════════════════════════════════════════════════════════════════════
// This file used to be pure localStorage. It's now backed by Supabase,
// matching the tables already defined in supabase/schema.sql
// (uploaded_months, attendance_records, column_mappings, ...).
//
// Every function keeps its original name/signature so no caller (page.tsx,
// ExportPanel, SettingsPanel, BackupPanel, EmployeeComparisonPanel, etc.)
// needs to change — they already `await` these calls.
//
// Row dates are trusted to be strict "YYYY-MM-DD" by the time they reach
// saveRecords() — that normalization happens once, at CSV parse time, in
// lib/parseCSV.ts. Don't re-introduce raw/unnormalized dates here.
// ═══════════════════════════════════════════════════════════════════════════

const UPSERT_BATCH_SIZE = 500; // keep upsert payloads reasonably sized

// ── Column Mappings (table: column_mappings) ─────────────────────────────────

export async function getMapping(officeCode: string): Promise<ColumnMapping | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('column_mappings')
    .select('mapping')
    .eq('office_code', officeCode)
    .maybeSingle();
  if (error) {
    console.error('getMapping failed:', error);
    return null;
  }
  return (data?.mapping as ColumnMapping | undefined) ?? null;
}

export async function saveMapping(officeCode: string, mapping: ColumnMapping): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('column_mappings')
    .upsert(
      { office_code: officeCode, mapping, updated_at: new Date().toISOString() },
      { onConflict: 'office_code' }
    );
  if (error) throw error;
}

export async function getAllMappings(): Promise<Record<string, ColumnMapping>> {
  const supabase = createClient();
  const { data, error } = await supabase.from('column_mappings').select('office_code, mapping');
  if (error) {
    console.error('getAllMappings failed:', error);
    return {};
  }
  const all: Record<string, ColumnMapping> = {};
  for (const row of data ?? []) {
    all[row.office_code as string] = row.mapping as ColumnMapping;
  }
  return all;
}

export async function deleteMapping(officeCode: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('column_mappings').delete().eq('office_code', officeCode);
  if (error) throw error;
}

// ── Attendance Records (table: attendance_records) ───────────────────────────

function toDbRow(monthKey: string, r: AttendanceRecord) {
  return {
    month_key: monthKey,
    employee_code: r.employeeCode,
    employee_name: r.employeeName,
    department: r.department,
    date: r.date, // must already be YYYY-MM-DD — see lib/parseCSV.ts normalizeDate()
    in_time: r.inTime || null,
    out_time: r.outTime || null,
    status: r.status || null,
    punch_records: r.punchRecords ?? null,
    late_by: r.lateBy ?? null,
    early_by: r.earlyBy ?? null,
    overtime: r.overtime ?? null,
    duration: r.duration ?? null,
    office_code: r.officeCode,
    punch_count: r.punchCount ?? null,
    is_short_day: r.isShortDay ?? null,
    extra_fields: r.extraFields ?? null,
    late_is_estimated: r.lateIsEstimated ?? null,
    early_is_estimated: r.earlyIsEstimated ?? null,
    updated_at: new Date().toISOString(),
  };
}

function fromDbRow(row: Record<string, unknown>): AttendanceRecord {
  return {
    date: normalizeDate((row.date as string) ?? ''),
    employeeCode: row.employee_code as string,
    employeeName: row.employee_name as string,
    department: row.department as string,
    inTime: (row.in_time as string) ?? '',
    outTime: (row.out_time as string) ?? '',
    status: (row.status as string) ?? '',
    punchRecords: (row.punch_records as string) ?? undefined,
    lateBy: (row.late_by as string) ?? '0:00',
    earlyBy: (row.early_by as string) ?? '0:00',
    overtime: (row.overtime as string) ?? undefined,
    duration: (row.duration as string) ?? '0:00',
    officeCode: row.office_code as string,
    punchCount: (row.punch_count as number) ?? undefined,
    isShortDay: (row.is_short_day as boolean) ?? undefined,
    extraFields: (row.extra_fields as Record<string, string>) ?? undefined,
    lateIsEstimated: (row.late_is_estimated as boolean) ?? undefined,
    earlyIsEstimated: (row.early_is_estimated as boolean) ?? undefined,
  };
}

// Upsert-by (employee_code, date, office_code) — matches the `unique` constraint
// on attendance_records in supabase/schema.sql. New rows overwrite the old row
// for that compound key; unrelated existing rows are untouched.
export async function saveRecords(
  monthKey: string,
  records: AttendanceRecord[]
): Promise<{ added: number; updated: number }> {
  if (records.length === 0) return { added: 0, updated: 0 };
  const supabase = createClient();

  // Figure out added vs. updated BEFORE upserting, by checking which
  // (employee_code, date, office_code) combos already exist for this month.
  const { data: existingRows, error: fetchErr } = await supabase
    .from('attendance_records')
    .select('employee_code, date, office_code')
    .eq('month_key', monthKey);
  if (fetchErr) throw fetchErr;

  const existingSet = new Set(
    (existingRows ?? []).map((r) => `${r.employee_code}__${r.date}__${r.office_code}`)
  );
  let added = 0;
  let updated = 0;
  for (const r of records) {
    const k = `${r.employeeCode}__${r.date}__${r.officeCode}`;
    if (existingSet.has(k)) updated++;
    else added++;
  }

  const rows = records.map((r) => toDbRow(monthKey, r));
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase
      .from('attendance_records')
      .upsert(batch, { onConflict: 'employee_code,date,office_code' });
    if (error) throw error;
  }

  return { added, updated };
}

export async function getRecords(monthKey: string): Promise<AttendanceRecord[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('month_key', monthKey);
  if (error) {
    console.error('getRecords failed:', error);
    return [];
  }
  const records = (data ?? []).map(fromDbRow);
  // Overlay any HR-made department reassignments / deletions — non-destructive,
  // the underlying DB rows are never touched by this.
  return applyEmployeeDirectory(records);
}

export async function getAllRecords(): Promise<AttendanceRecord[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('attendance_records').select('*');
  if (error) {
    console.error('getAllRecords failed:', error);
    return [];
  }
  return applyEmployeeDirectory((data ?? []).map(fromDbRow));
}

// One employee's records from every uploaded month (same office), sorted
// oldest → newest, for "compare with own previous month" view.
export async function getEmployeeMonthHistory(
  employeeCode: string,
  officeCode: string
): Promise<
  { monthKey: string; label: string; year: string; month: string; officeCode: string; records: AttendanceRecord[] }[]
> {
  const months = (await getUploadedMonths()).filter((m) => m.officeCode === officeCode);
  const results = await Promise.all(
    months.map(async (m) => ({
      monthKey: m.key,
      label: m.label,
      year: m.year,
      month: m.month,
      officeCode: m.officeCode,
      records: (await getRecords(m.key)).filter((r) => r.employeeCode === employeeCode),
    }))
  );
  return results
    .filter((m) => m.records.length > 0)
    .sort((a, b) => `${a.records[0]?.date}`.localeCompare(`${b.records[0]?.date}`));
}

// ── Uploaded Months (table: uploaded_months) ──────────────────────────────────

export async function getUploadedMonths(): Promise<UploadedMonth[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('uploaded_months')
    .select('key, label, office_code, month, year')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('getUploadedMonths failed:', error);
    return [];
  }
  return (data ?? []).map((m) => ({
    key: m.key as string,
    label: m.label as string,
    officeCode: m.office_code as string,
    month: m.month as string,
    year: m.year as string,
  }));
}

// Must be called (and awaited) BEFORE saveRecords() for the same monthKey —
// attendance_records.month_key has a foreign key referencing uploaded_months.key,
// so inserting attendance rows first would throw a 23503 FK violation.
export async function addUploadedMonth(month: UploadedMonth): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('uploaded_months')
    .upsert(
      { key: month.key, label: month.label, office_code: month.officeCode, month: month.month, year: month.year },
      { onConflict: 'key' }
    );
  if (error) throw error;
}

// ── Full data backup / restore ────────────────────────────────────────────────
// Everything now lives in Supabase across several tables (rather than one flat
// localStorage namespace), so export/import walks each table explicitly.
// NOTE: this is a NEW backup format (version 2). Old (version 1, localStorage-
// era) backup files are no longer compatible — re-export a fresh one.

const BACKUP_TABLES = [
  'uploaded_months',
  'attendance_records',
  'column_mappings',
  'leave_records',
  'custom_holidays',
  'dashboard_settings',
] as const;

type BackupTable = (typeof BACKUP_TABLES)[number];

const BACKUP_CONFLICT_KEYS: Record<BackupTable, string> = {
  uploaded_months: 'key',
  attendance_records: 'employee_code,date,office_code',
  column_mappings: 'office_code',
  leave_records: 'employee_code,date',
  custom_holidays: 'office_code,year,date',
  dashboard_settings: 'id',
};

export interface BackupFile {
  app: 'attendance-dashboard-poc';
  version: 2;
  exportedAt: string;
  data: Record<BackupTable, Record<string, unknown>[]>;
}

export async function exportAllData(): Promise<BackupFile> {
  const supabase = createClient();
  const results = await Promise.all(BACKUP_TABLES.map((t) => supabase.from(t).select('*')));

  const data = {} as Record<BackupTable, Record<string, unknown>[]>;
  BACKUP_TABLES.forEach((table, i) => {
    const { data: rows, error } = results[i];
    if (error) console.error(`exportAllData: failed to read "${table}":`, error);
    data[table] = rows ?? [];
  });

  return {
    app: 'attendance-dashboard-poc',
    version: 2,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export async function importAllData(backup: BackupFile): Promise<{ imported: number }> {
  if (!backup || typeof backup !== 'object' || !backup.data || typeof backup.data !== 'object') {
    throw new Error('Invalid backup file');
  }
  if (backup.version !== 2) {
    throw new Error(
      'This backup is from an older version of the app (pre-Supabase) and can no longer be restored. Please use a backup exported after the database migration.'
    );
  }

  const supabase = createClient();
  let imported = 0;

  // uploaded_months first — attendance_records references it via foreign key.
  for (const table of BACKUP_TABLES) {
    const rows = backup.data[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const conflictKey = BACKUP_CONFLICT_KEYS[table];
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
      const { error } = await supabase.from(table).upsert(batch, { onConflict: conflictKey });
      if (error) throw error;
      imported += batch.length;
    }
  }

  return { imported };
}