export interface AttendanceRecord {
  date: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  inTime: string;
  outTime: string;
  status: string;
  punchRecords?: string;
  lateBy: string;
  earlyBy: string;
  overtime?: string;
  duration: string;
  officeCode: string;
  // v4 additions
  punchCount?: number;
  isShortDay?: boolean;
  // v5 additions
  extraFields?: Record<string, string>;
  lateIsEstimated?: boolean;
  earlyIsEstimated?: boolean;
}

// ── v5: Leave Management (B7) ────────────────────────────────────────────────
export type LeaveType = 'planned' | 'casual' | 'sick' | 'lwp' | 'half_day';

export interface LeaveRecord {
  employeeCode: string;
  officeCode: string;
  date: string; // YYYY-MM-DD
  leaveType: LeaveType;
  halfDayLeaveType?: LeaveType;
  markedBy?: string;
  markedAt: string;
  note?: string;
}

// D7-3 (stretch — see lib/leaveTrackerRead.ts's getWorkforceEvents and
// app/api/dashboard/workforce-events/route.ts): WFH / Business Travel /
// Office Shutdown markers, live-read from the Leave Tracker's
// workforce_events table the same way LeaveRecord is. Deliberately its
// own type rather than folded into LeaveType — these are not leave (see
// supabase-leave/schema.sql's design invariants) and mixing them into
// the same field would make "is this person on leave" ambiguous
// everywhere LeaveType is already checked.
export type WorkforceEventType = 'wfh' | 'business_travel' | 'office_shutdown';

export interface WorkforceEvent {
  employeeCode: string;
  officeCode: string;
  date: string; // YYYY-MM-DD
  eventType: WorkforceEventType;
  note?: string;
}

export type EffectiveStatus =
  | 'present' | 'absent' | 'missed_punch_out'
  | 'leave_planned' | 'leave_casual' | 'leave_sick' | 'leave_lwp'
  | 'half_day' | 'weeklyoff' | 'holiday'
  | 'wfh' | 'business_travel' | 'office_shutdown';

export interface Thresholds {
  attendanceRateGreen: number; attendanceRateAmber: number;
  absenteeismRateGreen: number; absenteeismRateAmber: number;
  avgHoursPctGreen: number; avgHoursPctAmber: number;
  lateRateGreen: number; lateRateAmber: number;
  earlyRateGreen: number; earlyRateAmber: number;
  productivityLostGreen: number; productivityLostAmber: number;
  shortDayMinutes: number;
  frequentPunchCount: number;
  graceMinutes: number;
  // v5.1: shift window is configurable — hardcoding 09:30–18:30 was producing
  // wildly wrong Late/Early rates for offices on a different shift schedule
  shiftStartMinutes: number; // minutes from midnight, e.g. 570 = 09:30
  shiftEndMinutes: number;   // minutes from midnight, e.g. 1110 = 18:30
}

export interface ColumnMapping {
  employeeCode: string;
  employeeName: string;
  date: string;
  inTime: string;
  outTime: string;
  status: string;
  lateBy: string;
  earlyBy: string;
  duration: string;
  department: string;
}

export interface DayWiseLateEarly {
  date: string;
  inTime: string;
  outTime: string;
  lateMinutes: number;
  earlyMinutes: number;
}

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  source?: 'predefined' | 'custom';
}

export interface MonthlyTrendPoint {
  monthKey: string;
  label: string;
  attendanceRate: number;
  lateCount: number;
  earlyExitCount: number;
  avgHours: number;
  absentDays: number;
}

export interface EmployeeSummary {
  employeeCode: string;
  employeeName: string;
  department: string;
  officeCode: string;
  presentDays: number;
  absentDays: number;
  lateCount: number;
  earlyExitCount: number;
  missedPunchOutCount?: number;
  avgHoursWorked: string;
  totalMinutes: number;
  worstStatus: 'green' | 'amber' | 'red';
  records?: AttendanceRecord[];
  // drill-down extras
  avgLateMinutes?: number;
  avgEarlyExitMinutes?: number;
  latestInTime?: number;
  earliestOutTime?: number;
  // v6 additions: punctuality consistency (mean punch time +/- how spread out it is)
  avgInTime?: number;    // mean in-punch, minutes from midnight
  avgOutTime?: number;   // mean out-punch, minutes from midnight
  inTimeDeviation?: number;  // stddev of in-punch minutes, undefined if <2 samples
  outTimeDeviation?: number; // stddev of out-punch minutes, undefined if <2 samples
  dayWiseLateEarly?: DayWiseLateEarly[];
  // v4 additions
  shortDayCount: number;
  frequentPunchDays: number;
  monthlyTrend?: MonthlyTrendPoint[];
  // v5 additions (B7.3)
  plannedLeaveCount: number;
  casualLeaveCount: number;
  sickLeaveCount: number;
  lwpCount: number;
  halfDayCount: number;
  
}

export interface OfficeAttendance {
  office: string;
  rate: number;
  presentCount: number;
  scheduledCount: number;
}

export type ViewMode = 'monthly' | 'single_day' | 'comparison';

export interface DayDeptSnapshot {
  department: string;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  earlyCount: number;
  hoursLost: number; // hours for that day
  scheduledCount: number;
}

export interface KPIData {
  attendanceRate: number;
  absenteeismRate: number;
  avgWorkingHours: number;
  lateArrivalRate: number;
  earlyExitRate: number;
  productivityLost: number;
  shortDayCount: number;
  frequentPuncherCount: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  earlyExitCount: number;
  scheduledCount: number;
  // v5 (B7.3)
  unexplainedAbsentCount: number;
  plannedLeaveCount: number;
  casualLeaveCount: number;
  sickLeaveCount: number;
  lwpCount: number;
  halfDayCount: number;
  productivityLostHours: number; // for single-day view (SRS 12.6.1)
}

export interface DailyTrend {
  date: string;      // MM-DD display format
  rawDate?: string;  // YYYY-MM-DD for click handlers / filtering
  attendanceRate: number;
  presentCount: number;
  totalCount: number;
  absentees: string[];
  lateCount?: number;
  earlyExitCount?: number;
  hoursLost?: number;
  shortDayCount?: number;
}

export interface DeptAttendance {
  department: string;
  rate: number;
  status: 'green' | 'amber' | 'red';
  productivityLostDays?: number;
}

export interface HoursDistribution {
  bin: string;
  count: number;
  minHours: number;
  avgHours?: number;
  department?: string;
}

export interface UploadedMonth {
  key: string;
  label: string;
  officeCode: string;
  month: string;
  year: string;
}