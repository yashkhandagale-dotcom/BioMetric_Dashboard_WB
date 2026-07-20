import { createServiceClient as createDashboardServiceClient } from '@/lib/supabase/server';
import { upsertLeaveRecordsWithClient } from '@/lib/leaveStorage';
import { mapTrackerLeaveType, TrackerLeaveTypeCode } from '@/lib/leaveSupabase/leaveTypeMap';
import { LeaveRecord } from '@/lib/types';

export interface SyncLeaveRequestInput {
  employeeCode: string;
  officeCode: string;
  leaveTypeCode: TrackerLeaveTypeCode;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (same as startDate when isHalfDay)
  isHalfDay: boolean;
  markedBy?: string;
  note?: string;
}

export interface SyncResult {
  synced: boolean;
  datesAttempted: string[];
  error?: string;
}

function expandDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur.getTime() <= last.getTime()) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

// Matches the main dashboard's own convention (app/page.tsx):
// `${year}_${month}_${officeCode}`, e.g. "2026_07_MUM".
function monthKeyFor(date: string, officeCode: string): string {
  const [year, month] = date.split('-');
  return `${year}_${month}_${officeCode}`;
}

/**
 * Write-through sync: expands the leave's date range into one
 * leave_records row per date and upserts into the MAIN dashboard
 * project's leave_records table, grouped by month_key since that's its
 * native write granularity.
 *
 * Uses the MAIN project's SERVICE-ROLE client (createServiceClient from
 * lib/supabase/server.ts), not the browser client that
 * upsertLeaveRecord()/saveLeaveRecords() normally run under — this
 * function is called from a Leave Tracker API route (its own Supabase
 * project, its own session), so there's no main-dashboard user session
 * for an anon-key client to act as. leave_records has no FK to
 * uploaded_months, so writing into a month nobody's uploaded biometric
 * data for yet is safe.
 *
 * Never throws. Two databases, no distributed transaction: the tracker
 * side has already committed by the time this runs, so failure here
 * means "recorded in the tracker, not yet reflected on the attendance
 * dashboard" — never a silent loss. Callers should persist the result
 * onto leave_requests.sync_status/sync_error and surface it to HR (see
 * app/api/leave/requests/route.ts and the retry-sync route).
 */
export async function syncLeaveRequestToMainDashboard(
  input: SyncLeaveRequestInput
): Promise<SyncResult> {
  const dates = input.isHalfDay ? [input.startDate] : expandDateRange(input.startDate, input.endDate);
  const { leaveType, halfDayLeaveType } = mapTrackerLeaveType(input.leaveTypeCode, input.isHalfDay);

  const recordsByMonth = new Map<string, LeaveRecord[]>();
  for (const date of dates) {
    const monthKey = monthKeyFor(date, input.officeCode);
    const record: LeaveRecord = {
      employeeCode: input.employeeCode,
      officeCode: input.officeCode,
      date,
      leaveType,
      halfDayLeaveType,
      markedBy: input.markedBy,
      markedAt: new Date().toISOString(),
      note: input.note,
    };
    const bucket = recordsByMonth.get(monthKey) ?? [];
    bucket.push(record);
    recordsByMonth.set(monthKey, bucket);
  }

  try {
    const dashboardService = createDashboardServiceClient();
    for (const [monthKey, records] of recordsByMonth) {
      const { error } = await upsertLeaveRecordsWithClient(dashboardService, monthKey, records);
      if (error) {
        return { synced: false, datesAttempted: dates, error };
      }
    }
    return { synced: true, datesAttempted: dates };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      synced: false,
      datesAttempted: dates,
      error: `Could not reach the attendance dashboard's database: ${message}`,
    };
  }
}