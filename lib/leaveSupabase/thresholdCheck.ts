import type { SupabaseClient } from '@supabase/supabase-js';
import { insertLeaveNotification } from './notifyLeaveEvent';
import { getEffectiveApproverId } from './organization';

// =====================================================================
// Leave threshold alerts (feedback item #4) — "if the number of leaves
// for a particular leave type crosses (within a week) the configured
// threshold, notify HR + relevant manager(s)". Wired as a scheduled job
// (see app/api/leave/admin/jobs/[job]/route.ts, job id
// 'leave-threshold-check') alongside the existing probation-accrual /
// annual-reset jobs, same GET-with-CRON_SECRET + POST-with-HR-session
// pattern.
//
// "Within a week" = the 7 days ending on the day the job runs (a
// trailing rolling window), grouped by leave_type — the config doesn't
// specify calendar week vs. rolling window, and a rolling window catches
// a burst that straddles a week boundary, which a fixed Mon-Sun bucket
// would miss for up to 6 days.
// =====================================================================

export interface ThresholdCheckResult {
  leaveTypeCode: string;
  weekStart: string;
  requestCount: number;
  threshold: number;
  breached: boolean;
  alerted: boolean;
  reason: string;
}

export async function runLeaveThresholdCheck(
  supabase: SupabaseClient,
  asOf: Date = new Date()
): Promise<{ results: ThresholdCheckResult[]; error: string | null }> {
  const windowEnd = asOf.toISOString().slice(0, 10);
  const windowStartDate = new Date(asOf.getTime() - 6 * 24 * 60 * 60 * 1000);
  const windowStart = windowStartDate.toISOString().slice(0, 10);

  const { data: thresholds, error: threshError } = await supabase
    .from('leave_type_thresholds')
    .select('leave_type_id, weekly_count_threshold, alert_enabled, leave_types ( code, display_name )')
    .eq('alert_enabled', true);
  if (threshError) return { results: [], error: threshError.message };

  const results: ThresholdCheckResult[] = [];

  for (const row of thresholds ?? []) {
    const leaveType = Array.isArray(row.leave_types) ? row.leave_types[0] : row.leave_types;
    if (!leaveType) continue;

    const { data: requests, error: reqError } = await supabase
      .from('leave_requests')
      .select('id, employee_id, employees!leave_requests_employee_id_fkey ( department, full_name )')
      .eq('leave_type_id', row.leave_type_id)
      .in('status', ['pending', 'approved', 'auto_lwp'])
      .gte('start_date', windowStart)
      .lte('start_date', windowEnd);
    if (reqError) return { results, error: reqError.message };

    const requestCount = (requests ?? []).length;
    const breached = requestCount >= row.weekly_count_threshold;

    let alerted = false;
    let reason = 'Below threshold — no alert needed.';

    if (breached) {
      // Dedupe: one alert per (leave_type, week_start) — week_start
      // here is just windowStart, i.e. this rolling window's start day,
      // so re-running the job the same day never double-fires.
      const { data: existingAlert } = await supabase
        .from('leave_threshold_alerts')
        .select('id')
        .eq('leave_type_id', row.leave_type_id)
        .eq('week_start', windowStart)
        .maybeSingle();

      if (existingAlert) {
        reason = 'Threshold breached, but already alerted for this window.';
      } else {
        const departmentCounts: Record<string, number> = {};
        for (const r of requests ?? []) {
          const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees;
          const dept = emp?.department ?? 'Unknown';
          departmentCounts[dept] = (departmentCounts[dept] ?? 0) + 1;
        }

        await supabase.from('leave_threshold_alerts').insert({
          leave_type_id: row.leave_type_id,
          week_start: windowStart,
          request_count: requestCount,
          threshold_at_fire: row.weekly_count_threshold,
          department_counts: departmentCounts,
        });

        await notifyThresholdBreach(supabase, leaveType.code, leaveType.display_name, requestCount, row.weekly_count_threshold, Object.keys(departmentCounts));
        alerted = true;
        reason = 'Threshold breached — HR and relevant managers notified.';
      }
    }

    results.push({
      leaveTypeCode: leaveType.code,
      weekStart: windowStart,
      requestCount,
      threshold: row.weekly_count_threshold,
      breached,
      alerted,
      reason,
    });
  }

  return { results, error: null };
}

async function notifyThresholdBreach(
  supabase: SupabaseClient,
  leaveTypeCode: string,
  leaveTypeLabel: string,
  requestCount: number,
  threshold: number,
  departments: string[]
) {
  const { data: hrEmployees } = await supabase.from('employees').select('id').in('role', ['hr', 'hr_super_admin']);

  const recipientIds = new Set<string>((hrEmployees ?? []).map((h) => h.id));

  // Also notify the manager of each affected department.
  for (const dept of departments) {
    const { approverId } = await getEffectiveApproverId(supabase, { department: dept, reporting_lead_id: null });
    if (approverId) recipientIds.add(approverId);
  }

  const title = `${leaveTypeLabel} requests crossed the weekly threshold`;
  const body = `${requestCount} ${leaveTypeCode} requests were filed in the last 7 days (threshold: ${threshold}). Affected department(s): ${departments.join(', ') || 'n/a'}.`;

  for (const id of recipientIds) {
    await insertLeaveNotification(supabase, {
      recipient_employee_id: id,
      type: 'leave_reminder', // reuses the existing notification type — see notifyLeaveEvent.ts's type union comment for why a dedicated type wasn't added
      title,
      body,
      leave_request_id: null,
    });
  }
}
