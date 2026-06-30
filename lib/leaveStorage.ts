import { LeaveRecord } from './types';

const PREFIX = 'leaves_';

export function getLeaveRecords(monthKey: string): LeaveRecord[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(PREFIX + monthKey);
  return raw ? JSON.parse(raw) : [];
}

export function saveLeaveRecords(monthKey: string, records: LeaveRecord[]): void {
  localStorage.setItem(PREFIX + monthKey, JSON.stringify(records));
}

export function upsertLeaveRecord(monthKey: string, record: LeaveRecord): void {
  const existing = getLeaveRecords(monthKey);
  const idx = existing.findIndex(
    (r) => r.employeeCode === record.employeeCode && r.date === record.date
  );
  if (idx >= 0) existing[idx] = record;
  else existing.push(record);
  saveLeaveRecords(monthKey, existing);
}

export function deleteLeaveRecord(monthKey: string, employeeCode: string, date: string): void {
  const existing = getLeaveRecords(monthKey);
  saveLeaveRecords(
    monthKey,
    existing.filter((r) => !(r.employeeCode === employeeCode && r.date === date))
  );
}

export function getAllLeaveRecords(monthKeys: string[]): LeaveRecord[] {
  return monthKeys.flatMap((k) => getLeaveRecords(k));
}
