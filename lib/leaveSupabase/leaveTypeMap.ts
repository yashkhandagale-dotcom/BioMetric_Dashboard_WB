import { LeaveType } from '@/lib/types';

// The Leave Tracker's leave_types.code values (supabase-leave/schema.sql)
// vs. the main dashboard's LeaveType union (lib/types.ts) — two systems,
// two vocabularies. This is the single place that translates between
// them; nothing else should hardcode this mapping (that's how the two
// sides drift out of sync).
export type TrackerLeaveTypeCode = 'SL' | 'CL' | 'PL' | 'LWP';

const CODE_TO_MAIN_TYPE: Record<TrackerLeaveTypeCode, LeaveType> = {
  SL: 'sick',
  CL: 'casual',
  PL: 'planned',
  LWP: 'lwp',
};

export interface MainDashboardLeaveFields {
  leaveType: LeaveType;
  halfDayLeaveType?: LeaveType;
}

/**
 * Maps a tracker leave_types.code (+ half-day flag) onto the shape the
 * main dashboard's leave_records table expects. The main side has no
 * separate "half day" leave type of its own — it's the single 'half_day'
 * bucket in LeaveType, with the actual type carried in halfDayLeaveType.
 */
export function mapTrackerLeaveType(
  code: TrackerLeaveTypeCode,
  isHalfDay: boolean
): MainDashboardLeaveFields {
  const mapped = CODE_TO_MAIN_TYPE[code];
  if (isHalfDay) {
    return { leaveType: 'half_day', halfDayLeaveType: mapped };
  }
  return { leaveType: mapped };
}