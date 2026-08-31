import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reconciles an approved full-day leave request against biometric attendance.
 *
 * A normal leave request is still entered as one continuous period. If the
 * biometric record for any covered date proves a short day (the same
 * first-to-last-punch <= 5-hour rule used by attendanceExceptions.ts), that
 * date counts as 0.5 leave instead of 1.0. The reconciliation is idempotent:
 * it always calculates the desired total from the request's date range and
 * adjusts the existing balance by only the difference.
 *
 * Explicit half-day requests are left alone because their half-day intent is
 * already authoritative. Missed-punch/single-punch cases are NOT treated as
 * half-day leave here; only a valid present record with a measurable duration
 * in the existing <= 5-hour threshold qualifies.
 */
export async function reconcileLeaveRequestAgainstAttendance(
  service: SupabaseClient,
  leaveRequestId: string
): Promise<{ ok: boolean; adjusted: boolean; previousTotal: number; totalDays: number; shortDates: string[]; error?: string }> {
  const { data: result, error } = await service.rpc('fn_reconcile_leave_attendance_days', {
    p_leave_request_id: leaveRequestId,
  });

  if (error) {
    return { ok: false, adjusted: false, previousTotal: 0, totalDays: 0, shortDates: [], error: error.message };
  }

  const row = Array.isArray(result) ? result[0] : result;
  return {
    ok: true,
    adjusted: Boolean(row?.adjusted),
    previousTotal: Number(row?.previous_total ?? 0),
    totalDays: Number(row?.total_days ?? 0),
    shortDates: Array.isArray(row?.short_dates) ? row.short_dates : [],
  };
}

export async function reconcileLeaveRequestsForAttendanceRange(
  service: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<{ checked: number; adjusted: number; errors: string[] }> {
  const { data: requests, error } = await service
    .from('leave_requests')
    .select('id')
    .in('status', ['approved', 'auto_lwp'])
    .eq('is_half_day', false)
    .lte('start_date', endDate)
    .gte('end_date', startDate);

  if (error) return { checked: 0, adjusted: 0, errors: [error.message] };

  let adjusted = 0;
  const errors: string[] = [];
  for (const request of requests ?? []) {
    const outcome = await reconcileLeaveRequestAgainstAttendance(service, request.id);
    if (!outcome.ok) errors.push(`${request.id}: ${outcome.error}`);
    else if (outcome.adjusted) adjusted += 1;
  }

  return { checked: requests?.length ?? 0, adjusted, errors };
}
