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

export type EffectiveStatus =
  | 'present' | 'absent'
  | 'leave_planned' | 'leave_casual' | 'leave_sick' | 'leave_lwp'
  | 'half_day' | 'weeklyoff' | 'holiday';

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

export interface ViewMode {
  type: 'monthly' | 'daily' | 'range';
  startDate?: string;
  endDate?: string;
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
  avgHoursWorked: string;
  totalMinutes: number;
  worstStatus: 'green' | 'amber' | 'red';
  records?: AttendanceRecord[];
  // drill-down extras
  avgLateMinutes?: number;
  avgEarlyExitMinutes?: number;
  latestInTime?: number;
  earliestOutTime?: number;
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
}

export interface DailyTrend {
  date: string;
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