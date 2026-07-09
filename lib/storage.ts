import { AttendanceRecord, ColumnMapping, UploadedMonth } from './types';
import { createClient } from './supabase/client';

// ── Column Mappings ──────────────────────────────────────────────────────────

export async function getMapping(officeCode: string): Promise<ColumnMapping | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('column_mappings')
    .select('mapping')
    .eq('office_code', officeCode)
    .maybeSingle();
  return (data?.mapping as ColumnMapping) ?? null;
}

export async function saveMapping(officeCode: string, mapping: ColumnMapping): Promise<void> {
  const supabase = createClient();
  await supabase
    .from('column_mappings')
    .upsert({ office_code: officeCode, mapping, updated_at: new Date().toISOString() });
}

export async function getAllMappings(): Promise<Record<string, ColumnMapping>> {
  const supabase = createClient();
  const { data } = await supabase.from('column_mappings').select('office_code, mapping');
  const result: Record<string, ColumnMapping> = {};
  (data ?? []).forEach((row) => {
    result[row.office_code] = row.mapping as ColumnMapping;
  });
  return result;
}

export async function deleteMapping(officeCode: string): Promise<void> {
  const supabase = createClient();
  await supabase.from('column_mappings').delete().eq('office_code', officeCode);
}

// ── Attendance Records ───────────────────────────────────────────────────────

function toRow(monthKey: string, r: AttendanceRecord) {
  return {
    month_key: monthKey,
    employee_code: r.employeeCode,
    employee_name: r.employeeName,
    department: r.department,
    date: r.date,
    in_time: r.inTime,
    out_time: r.outTime,
    status: r.status,
    punch_records: r.punchRecords,
    late_by: r.lateBy,
    early_by: r.earlyBy,
    overtime: r.overtime,
    duration: r.duration,
    office_code: r.officeCode,
    punch_count: r.punchCount,
    is_short_day: r.isShortDay,
    extra_fields: r.extraFields ?? null,
    late_is_estimated: r.lateIsEstimated,
    early_is_estimated: r.earlyIsEstimated,
    updated_at: new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRow(row: any): AttendanceRecord {
  return {
    date: row.date,
    employeeCode: row.employee_code,
    employeeName: row.employee_name,
    department: row.department,
    inTime: row.in_time,
    outTime: row.out_time,
    status: row.status,
    punchRecords: row.punch_records ?? undefined,
    lateBy: row.late_by,
    earlyBy: row.early_by,
    overtime: row.overtime ?? undefined,
    duration: row.duration,
    officeCode: row.office_code,
    punchCount: row.punch_count ?? undefined,
    isShortDay: row.is_short_day ?? undefined,
    extraFields: row.extra_fields ?? undefined,
    lateIsEstimated: row.late_is_estimated ?? undefined,
    earlyIsEstimated: row.early_is_estimated ?? undefined,
  };
}

// A3: upsert-by (employeeCode, date, officeCode) — new records overwrite the
// old one for that compound key. Supabase does this natively via the unique
// constraint on (employee_code, date, office_code) + upsert.
export async function saveRecords(
  monthKey: string,
  records: AttendanceRecord[]
): Promise<{ added: number; updated: number }> {
  const supabase = createClient();

  // Work out added vs. updated by checking which keys already exist.
  const keys = records.map((r) => `${r.employeeCode}__${r.date}__${r.officeCode}`);
  const { data: existingRows } = await supabase
    .from('attendance_records')
    .select('employee_code, date, office_code')
    .eq('month_key', monthKey);
  const existingKeys = new Set(
    (existingRows ?? []).map((r) => `${r.employee_code}__${r.date}__${r.office_code}`)
  );
  let added = 0, updated = 0;
  keys.forEach((k) => (existingKeys.has(k) ? updated++ : added++));

  const rows = records.map((r) => toRow(monthKey, r));
  // Chunk to stay comfortably under request size limits on large CSVs.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('attendance_records')
      .upsert(chunk, { onConflict: 'employee_code,date,office_code' });
    if (error) throw error;
  }

  return { added, updated };
}

export async function getRecords(monthKey: string): Promise<AttendanceRecord[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('month_key', monthKey);
  return (data ?? []).map(fromRow);
}

export async function getAllRecords(): Promise<AttendanceRecord[]> {
  const supabase = createClient();
  const { data } = await supabase.from('attendance_records').select('*');
  return (data ?? []).map(fromRow);
}

// ── B8: pull one employee's records from every uploaded month (same office),
// sorted oldest → newest, for "compare with own previous month" view. ──────────
export async function getEmployeeMonthHistory(
  employeeCode: string,
  officeCode: string
): Promise<{ monthKey: string; label: string; year: string; month: string; officeCode: string; records: AttendanceRecord[] }[]> {
  const supabase = createClient();
  const { data: months } = await supabase
    .from('uploaded_months')
    .select('*')
    .eq('office_code', officeCode);
  const { data: rows } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('employee_code', employeeCode)
    .eq('office_code', officeCode);

  const recordsByMonth = new Map<string, AttendanceRecord[]>();
  (rows ?? []).forEach((row) => {
    const monthKey = row.month_key as string;
    if (!recordsByMonth.has(monthKey)) recordsByMonth.set(monthKey, []);
    recordsByMonth.get(monthKey)!.push(fromRow(row));
  });

  return (months ?? [])
    .map((m) => ({
      monthKey: m.key,
      label: m.label,
      year: m.year,
      month: m.month,
      officeCode: m.office_code,
      records: recordsByMonth.get(m.key) ?? [],
    }))
    .filter((m) => m.records.length > 0)
    .sort((a, b) => `${a.records[0]?.date}`.localeCompare(`${b.records[0]?.date}`));
}

// ── Uploaded Months ──────────────────────────────────────────────────────────

export async function getUploadedMonths(): Promise<UploadedMonth[]> {
  const supabase = createClient();
  const { data } = await supabase.from('uploaded_months').select('*').order('created_at');
  return (data ?? []).map((m) => ({
    key: m.key,
    label: m.label,
    officeCode: m.office_code,
    month: m.month,
    year: m.year,
  }));
}

export async function addUploadedMonth(month: UploadedMonth): Promise<void> {
  const supabase = createClient();
  await supabase.from('uploaded_months').upsert({
    key: month.key,
    label: month.label,
    office_code: month.officeCode,
    month: month.month,
    year: month.year,
  });
}

// ── Full data backup / restore ───────────────────────────────────────────────
// Everything the app keeps now lives in Supabase. Export/import pulls every
// table down as one JSON blob — handy for point-in-time backups, or for a
// one-time migration from an older localStorage-only deployment.

export interface BackupFile {
  app: 'attendance-dashboard';
  version: 2;
  exportedAt: string;
  data: {
    uploaded_months: unknown[];
    attendance_records: unknown[];
    column_mappings: unknown[];
    leave_records: unknown[];
    custom_holidays: unknown[];
    dashboard_settings: unknown[];
  };
}

export async function exportAllData(): Promise<BackupFile> {
  const supabase = createClient();
  const [months, records, mappings, leaves, holidays, settings] = await Promise.all([
    supabase.from('uploaded_months').select('*'),
    supabase.from('attendance_records').select('*'),
    supabase.from('column_mappings').select('*'),
    supabase.from('leave_records').select('*'),
    supabase.from('custom_holidays').select('*'),
    supabase.from('dashboard_settings').select('*'),
  ]);
  return {
    app: 'attendance-dashboard',
    version: 2,
    exportedAt: new Date().toISOString(),
    data: {
      uploaded_months: months.data ?? [],
      attendance_records: records.data ?? [],
      column_mappings: mappings.data ?? [],
      leave_records: leaves.data ?? [],
      custom_holidays: holidays.data ?? [],
      dashboard_settings: settings.data ?? [],
    },
  };
}

export async function importAllData(backup: BackupFile): Promise<{ imported: number }> {
  if (!backup || typeof backup !== 'object' || !backup.data) {
    throw new Error('Invalid backup file');
  }
  const supabase = createClient();
  let imported = 0;
  const tables = Object.keys(backup.data) as (keyof BackupFile['data'])[];
  for (const table of tables) {
    const rows = backup.data[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const { error } = await supabase.from(table).upsert(rows);
    if (!error) imported += rows.length;
  }
  return { imported };
}
