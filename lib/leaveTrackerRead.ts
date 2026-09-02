import { LeaveRecord, WorkforceEvent } from './types';

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

  // If the server returned 404, return a clear error immediately rather
  // than attempting to parse the body as JSON (often HTML). This helps
  // debugging when a route is missing or not registered by Next.
  if (res.status === 404) {
    const excerpt = (text || '').slice(0, 200).replace(/\n/g, ' ');
    throw new Error(`Leave records route not found (404). Response excerpt: ${excerpt}`);
  }

  let body: any = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (err) {
      // Non-JSON response (for example an auth redirect that returned HTML).
      // Surface a short excerpt to help debugging rather than crashing with
      // "Unexpected token '<'" from JSON.parse.
      const excerpt = text.slice(0, 200).replace(/\n/g, ' ');
      throw new Error(`Unexpected non-JSON response from leave-records route (status ${res.status}): ${excerpt}`);
    }
  }
  if (!res.ok) {
    throw new Error(body.error || `Failed to load leave data (${res.status})`);
  }
  return (body.records ?? []) as LeaveRecord[];
}

export async function getLeaveRecords(monthKey: string): Promise<LeaveRecord[]> {
  return getAllLeaveRecords([monthKey]);
}

/**
 * D7-3 (stretch): same live-read pattern as getAllLeaveRecords, for the
 * new workforce_events table (WFH / Business Travel / Office Shutdown —
 * see app/api/dashboard/workforce-events/route.ts). Kept as its own
 * function rather than merged into getAllLeaveRecords's response, since
 * these aren't leave and callers that only care about leave shouldn't
 * have to filter them back out.
 */
export async function getAllWorkforceEvents(monthKeys: string[]): Promise<WorkforceEvent[]> {
  if (monthKeys.length === 0) return [];
  const res = await fetch(`/api/dashboard/workforce-events?monthKeys=${encodeURIComponent(monthKeys.join(','))}`);
  const text = await res.text();

  if (res.status === 404) {
    const excerpt = (text || '').slice(0, 200).replace(/\n/g, ' ');
    throw new Error(`Workforce events route not found (404). Response excerpt: ${excerpt}`);
  }

  let body: any = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (err) {
      const excerpt = text.slice(0, 200).replace(/\n/g, ' ');
      throw new Error(`Unexpected non-JSON response from workforce-events route (status ${res.status}): ${excerpt}`);
    }
  }
  if (!res.ok) {
    throw new Error(body.error || `Failed to load workforce events (${res.status})`);
  }
  return (body.events ?? []) as WorkforceEvent[];
}

export async function getWorkforceEvents(monthKey: string): Promise<WorkforceEvent[]> {
  return getAllWorkforceEvents([monthKey]);
}

/**
 * Batch lookup helper: accepts an array of { employeeCode, date, officeCode }
 * and returns any matching LeaveRecord entries from the Leave Tracker.
 * Used as a fallback when an absent day was not present in the monthly
 * leave-records response (for example, because the tracker used a different
 * status like 'auto_lwp').
 */
export async function lookupLeavesForItems(items: { employeeCode: string; date: string; officeCode: string }[]) : Promise<LeaveRecord[]> {
  if (!items || items.length === 0) return [];
  const res = await fetch('/api/dashboard/leave-lookup-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const text = await res.text();
  if (res.status === 404) {
    const excerpt = (text || '').slice(0, 200).replace(/\n/g, ' ');
    throw new Error(`Leave lookup route not found (404). Response excerpt: ${excerpt}`);
  }
  let body: any = {};
  if (text) {
    try { body = JSON.parse(text); } catch (err) {
      const excerpt = text.slice(0, 200).replace(/\n/g, ' ');
      throw new Error(`Unexpected non-JSON response from leave-lookup-batch (status ${res.status}): ${excerpt}`);
    }
  }
  if (!res.ok) throw new Error(body.error || `Failed to load leave lookup (${res.status})`);
  return (body.records ?? []) as LeaveRecord[];
}