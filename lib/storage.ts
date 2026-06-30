import { AttendanceRecord, ColumnMapping, UploadedMonth } from './types';

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

export function getAllMappings(): Record<string, ColumnMapping> {
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

export function saveRecords(
  monthKey: string,
  records: AttendanceRecord[]
): { added: number; updated: number } {
  const existing = getRecords(monthKey);
  const { merged, added, updated } = mergeRecords(existing, records);
  localStorage.setItem(KEYS.RECORDS_PREFIX + monthKey, JSON.stringify(merged));
  return { added, updated };
}

export function getRecords(monthKey: string): AttendanceRecord[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(KEYS.RECORDS_PREFIX + monthKey);
  return raw ? JSON.parse(raw) : [];
}

export function getAllRecords(): AttendanceRecord[] {
  if (typeof window === 'undefined') return [];
  const months = getUploadedMonths();
  return months.flatMap((m) => getRecords(m.key));
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
