import { LeaveRecord } from './types';

/**
 * Live-reads leave data for the given monthKeys (`${year}_${month}_${officeCode}`)
 * from the Leave Tracker, via the main dashboard's own server route
 * (app/api/dashboard/leave-records). This replaced the old duplicated
 * leave_records table + write-through sync (lib/leaveStorage.ts /
 * lib/leaveSync.ts) — there is now exactly one place leave data lives,
 * so there's nothing to drift.
 *
 * Unlike the old getAllLeaveRecords(), this throws on failure rather
 * than swallowing it into an empty array — an outage here should be
 * visible to HR (e.g. via a toast), not silently reported as "nobody is
 * on leave."
 */
export async function getAllLeaveRecords(monthKeys: string[]): Promise<LeaveRecord[]> {
  if (monthKeys.length === 0) return [];
  const res = await fetch(`/api/dashboard/leave-records?monthKeys=${encodeURIComponent(monthKeys.join(','))}`);
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(body.error || `Failed to load leave data (${res.status})`);
  }
  return (body.records ?? []) as LeaveRecord[];
}

export async function getLeaveRecords(monthKey: string): Promise<LeaveRecord[]> {
  return getAllLeaveRecords([monthKey]);
}
