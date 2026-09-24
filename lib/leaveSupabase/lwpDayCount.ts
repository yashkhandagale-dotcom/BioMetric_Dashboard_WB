import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Calculates the number of leave days in a request that fall within
 * [windowStartStr, windowEndStr] inclusive.
 * Handles single-day (full/half) and multi-day spans proportionally.
 */
export function countDaysInWindow(
  startDateStr: string,
  endDateStr: string,
  totalDays: number,
  windowStartStr: string,
  windowEndStr: string
): number {
  if (startDateStr > windowEndStr || endDateStr < windowStartStr) return 0;

  // Single-day request (e.g. 1.0 or 0.5)
  if (startDateStr === endDateStr) {
    if (startDateStr >= windowStartStr && startDateStr <= windowEndStr) {
      return totalDays;
    }
    return 0;
  }

  // Multi-day request entirely within window
  if (startDateStr >= windowStartStr && endDateStr <= windowEndStr) {
    return totalDays;
  }

  // Multi-day request overlapping window boundaries:
  // Proportion of calendar days within the clamped window
  const start = new Date(`${startDateStr}T00:00:00Z`);
  const end = new Date(`${endDateStr}T00:00:00Z`);
  const totalCalendarDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (totalCalendarDays <= 0) return 0;

  const effStart = startDateStr < windowStartStr ? new Date(`${windowStartStr}T00:00:00Z`) : start;
  const effEnd = endDateStr > windowEndStr ? new Date(`${windowEndStr}T00:00:00Z`) : end;
  const overlapCalendarDays = Math.max(0, Math.round((effEnd.getTime() - effStart.getTime()) / 86400000) + 1);

  const proportionalDays = totalDays * (overlapCalendarDays / totalCalendarDays);
  return Math.round(proportionalDays * 100) / 100;
}

/**
 * Counts approved/auto_lwp LWP days for a single employee in [windowStart, windowEnd].
 * Used by F&F calculator.
 */
export async function getLwpDaysForEmployee(
  supabase: SupabaseClient,
  employeeId: string,
  windowStart: string,
  windowEnd: string
): Promise<{ count: number; error: string | null }> {
  const { data: rows, error } = await supabase
    .from('leave_requests')
    .select('total_days, start_date, end_date, is_half_day, leave_types!inner(code)')
    .eq('employee_id', employeeId)
    .eq('leave_types.code', 'LWP')
    .in('status', ['approved', 'auto_lwp'])
    .lte('start_date', windowEnd)
    .gte('end_date', windowStart);

  if (error) return { count: 0, error: error.message };

  let count = 0;
  for (const r of rows ?? []) {
    count += countDaysInWindow(r.start_date, r.end_date, Number(r.total_days), windowStart, windowEnd);
  }

  return { count: Math.round(count * 100) / 100, error: null };
}

/**
 * Batch counts approved/auto_lwp LWP days for multiple employees in [windowStart, windowEnd].
 * Used by Monthly Payable-Days Report to avoid N+1 queries.
 */
export async function getLwpDaysForEmployees(
  supabase: SupabaseClient,
  employeeIds: string[],
  windowStart: string,
  windowEnd: string
): Promise<{ countMap: Map<string, number>; error: string | null }> {
  const countMap = new Map<string, number>();
  for (const id of employeeIds) countMap.set(id, 0);

  if (employeeIds.length === 0) return { countMap, error: null };

  const { data: rows, error } = await supabase
    .from('leave_requests')
    .select('employee_id, total_days, start_date, end_date, is_half_day, leave_types!inner(code)')
    .in('employee_id', employeeIds)
    .eq('leave_types.code', 'LWP')
    .in('status', ['approved', 'auto_lwp'])
    .lte('start_date', windowEnd)
    .gte('end_date', windowStart);

  if (error) return { countMap, error: error.message };

  for (const r of rows ?? []) {
    const days = countDaysInWindow(r.start_date, r.end_date, Number(r.total_days), windowStart, windowEnd);
    const prev = countMap.get(r.employee_id) ?? 0;
    countMap.set(r.employee_id, Math.round((prev + days) * 100) / 100);
  }

  return { countMap, error: null };
}
