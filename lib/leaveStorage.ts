import type { SupabaseClient } from '@supabase/supabase-js';
import { LeaveRecord } from './types';
import { createClient } from './supabase/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRow(row: any): LeaveRecord {
  return {
    employeeCode: row.employee_code,
    officeCode: row.office_code,
    date: row.date,
    leaveType: row.leave_type,
    halfDayLeaveType: row.half_day_leave_type ?? undefined,
    markedBy: row.marked_by ?? undefined,
    markedAt: row.marked_at,
    note: row.note ?? undefined,
  };
}

function toRow(monthKey: string, r: LeaveRecord) {
  return {
    month_key: monthKey,
    employee_code: r.employeeCode,
    office_code: r.officeCode,
    date: r.date,
    leave_type: r.leaveType,
    half_day_leave_type: r.halfDayLeaveType ?? null,
    marked_by: r.markedBy ?? null,
    marked_at: r.markedAt || new Date().toISOString(),
    note: r.note ?? null,
  };
}

export async function getLeaveRecords(monthKey: string): Promise<LeaveRecord[]> {
  const supabase = createClient();
  const { data } = await supabase.from('leave_records').select('*').eq('month_key', monthKey);
  return (data ?? []).map(fromRow);
}

// Client-parametrized version of the upsert below. Exists so callers
// outside the browser — e.g. the Leave Tracker's write-through sync in
// lib/leaveSync.ts, which runs server-side with no dashboard user
// session to authenticate the anon-key client — can reuse this exact
// row shape with a service-role client instead. Do not duplicate the
// toRow() mapping elsewhere; add a client-taking wrapper here instead.
export async function upsertLeaveRecordsWithClient(
  supabase: SupabaseClient,
  monthKey: string,
  records: LeaveRecord[]
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('leave_records')
    .upsert(records.map((r) => toRow(monthKey, r)), { onConflict: 'employee_code,date' });
  return { error: error?.message ?? null };
}

export async function saveLeaveRecords(monthKey: string, records: LeaveRecord[]): Promise<void> {
  const supabase = createClient();
  await upsertLeaveRecordsWithClient(supabase, monthKey, records);
}

export async function upsertLeaveRecord(monthKey: string, record: LeaveRecord): Promise<void> {
  const supabase = createClient();
  await supabase
    .from('leave_records')
    .upsert(toRow(monthKey, record), { onConflict: 'employee_code,date' });
}

export async function deleteLeaveRecord(
  monthKey: string,
  employeeCode: string,
  date: string
): Promise<void> {
  const supabase = createClient();
  await supabase
    .from('leave_records')
    .delete()
    .eq('month_key', monthKey)
    .eq('employee_code', employeeCode)
    .eq('date', date);
}

export async function getAllLeaveRecords(monthKeys: string[]): Promise<LeaveRecord[]> {
  if (monthKeys.length === 0) return [];
  const supabase = createClient();
  const { data } = await supabase.from('leave_records').select('*').in('month_key', monthKeys);
  return (data ?? []).map(fromRow);
}