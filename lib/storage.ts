import { AttendanceRecord, ColumnMapping, UploadedMonth } from './types';
import { applyEmployeeDirectory } from './employeeStore';

const KEYS = {
  MAPPINGS: 'office_mappings',
  RECORDS_PREFIX: 'records_',
  MONTHS: 'uploaded_months',
  SHARED_TOKEN: 'shared_view_token',
};

// ── Column Mappings ──────────────────────────────────────────────────────────

export function getMapping(officeCode: string): ColumnMapping | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(KEYS.MAPPINGS);
  if (!raw) return null;
  const all = JSON.parse(raw) as Record<string, ColumnMapping>;
  return all[officeCode] || null;
}

export function saveMapping(officeCode: string, mapping: ColumnMapping): void {
  const raw = localStorage.getItem(KEYS.MAPPINGS);
  const all = raw ? (JSON.parse(raw) as Record<string, ColumnMapping>) : {};
  all[officeCode] = mapping;
  localStorage.setItem(KEYS.MAPPINGS, JSON.stringify(all));
}

export async function getAllMappings(): Promise<Record<string, ColumnMapping>> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(KEYS.MAPPINGS);
  return raw ? JSON.parse(raw) : {};
}

export function deleteMapping(officeCode: string): void {
  const raw = localStorage.getItem(KEYS.MAPPINGS);
  if (!raw) return;
  const all = JSON.parse(raw) as Record<string, ColumnMapping>;
  delete all[officeCode];
  localStorage.setItem(KEYS.MAPPINGS, JSON.stringify(all));
}

// ── Attendance Records ───────────────────────────────────────────────────────

function recordKey(r: AttendanceRecord): string {
  return `${r.employeeCode}__${r.date}__${r.officeCode}`;
}

// A3: upsert-by (employeeCode, date, officeCode) — new records overwrite the
// old one for that compound key, unrelated existing records are preserved.
export function mergeRecords(
  existing: AttendanceRecord[],
  incoming: AttendanceRecord[]
): { merged: AttendanceRecord[]; added: number; updated: number } {
  const map = new Map<string, AttendanceRecord>();
  for (const r of existing) map.set(recordKey(r), r);
  let added = 0, updated = 0;
  for (const r of incoming) {
    const k = recordKey(r);
    if (map.has(k)) updated++; else added++;
    map.set(k, r);
  }
  return { merged: Array.from(map.values()), added, updated };
}

function getRawRecords(monthKey: string): AttendanceRecord[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(KEYS.RECORDS_PREFIX + monthKey);
  return raw ? JSON.parse(raw) : [];
}

export function saveRecords(
  monthKey: string,
  records: AttendanceRecord[]
): { added: number; updated: number } {
  // Merge against RAW existing records (department overrides NOT applied) —
  // otherwise an HR department reassignment would get baked permanently into
  // storage the next time that office's CSV is re-uploaded/merged.
  const existing = getRawRecords(monthKey);
  const { merged, added, updated } = mergeRecords(existing, records);
  localStorage.setItem(KEYS.RECORDS_PREFIX + monthKey, JSON.stringify(merged));
  return { added, updated };
}

export function getRecords(monthKey: string): AttendanceRecord[] {
  const records = getRawRecords(monthKey);
  // Overlay any HR-made department reassignments / deletions (lib/employeeStore.ts) —
  // non-destructive, so the underlying CSV-derived data is never touched and
  // a future remap/backup still reflects what the machine actually reported.
  return applyEmployeeDirectory(records);
}

export function getAllRecords(): AttendanceRecord[] {
  if (typeof window === 'undefined') return [];
  const months = getUploadedMonths();
  return months.flatMap((m) => getRecords(m.key));
}

// ── B8: pull one employee's records from every uploaded month (same office),
// sorted oldest → newest, for "compare with own previous month" view. ──────────
export async function getEmployeeMonthHistory(
  employeeCode: string,
  officeCode: string
): Promise<{ monthKey: string; label: string; year: string; month: string; officeCode: string; records: AttendanceRecord[] }[]> {
  if (typeof window === 'undefined') return [];
  const months = getUploadedMonths().filter((m) => m.officeCode === officeCode);
  return months
    .map((m) => ({
      monthKey: m.key,
      label: m.label,
      year: m.year,
      month: m.month,
      officeCode: m.officeCode,
      records: getRecords(m.key).filter((r) => r.employeeCode === employeeCode),
    }))
    .filter((m) => m.records.length > 0)
    .sort((a, b) => `${a.records[0]?.date}`.localeCompare(`${b.records[0]?.date}`));
}

// ── Uploaded Months ──────────────────────────────────────────────────────────

export function getUploadedMonths(): UploadedMonth[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(KEYS.MONTHS);
  return raw ? JSON.parse(raw) : [];
}

export function addUploadedMonth(month: UploadedMonth): void {
  const months = getUploadedMonths();
  const existing = months.findIndex((m) => m.key === month.key);
  if (existing >= 0) {
    months[existing] = month;
  } else {
    months.push(month);
  }
  localStorage.setItem(KEYS.MONTHS, JSON.stringify(months));
}

// ── Shared Link Token ────────────────────────────────────────────────────────

export function generateToken(): string {
  const token = crypto.randomUUID();
  localStorage.setItem(KEYS.SHARED_TOKEN, token);
  return token;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEYS.SHARED_TOKEN);
}

export function validateToken(token: string): boolean {
  const stored = getToken();
  return stored === token;
}

// ── Full data backup / restore ───────────────────────────────────────────────
// Everything the app keeps — records, mappings, months, leaves, holidays,
// thresholds — lives in localStorage under various key prefixes. Rather than
// enumerate every prefix (and risk missing one as new features add keys),
// export/import the whole localStorage namespace as a single JSON blob, minus
// the legacy shared-link keys which are being phased out in favour of the
// server-side token store (see lib/sharedLink.ts).

const EXCLUDED_KEY_PREFIXES = ['share_'];
const EXCLUDED_KEYS = [KEYS.SHARED_TOKEN];

function isBackedUpKey(key: string): boolean {
  if (EXCLUDED_KEYS.includes(key)) return false;
  return !EXCLUDED_KEY_PREFIXES.some((p) => key.startsWith(p));
}

export interface BackupFile {
  app: 'attendance-dashboard-poc';
  version: 1;
  exportedAt: string;
  data: Record<string, string>;
}

export function exportAllData(): BackupFile {
  const data: Record<string, string> = {};
  if (typeof window !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isBackedUpKey(key)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) data[key] = value;
    }
  }
  return {
    app: 'attendance-dashboard-poc',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function importAllData(backup: BackupFile): { imported: number } {
  if (!backup || typeof backup !== 'object' || !backup.data || typeof backup.data !== 'object') {
    throw new Error('Invalid backup file');
  }
  let imported = 0;
  for (const [key, value] of Object.entries(backup.data)) {
    if (typeof value !== 'string') continue;
    localStorage.setItem(key, value);
    imported++;
  }
  return { imported };
}