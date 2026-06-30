import { Thresholds } from './types';

const KEY = 'dashboard_thresholds';

export const DEFAULT_THRESHOLDS: Thresholds = {
  attendanceRateGreen: 80, attendanceRateAmber: 70,
  absenteeismRateGreen: 20, absenteeismRateAmber: 30,
  avgHoursPctGreen: 85, avgHoursPctAmber: 75,
  lateRateGreen: 10, lateRateAmber: 20,
  earlyRateGreen: 15, earlyRateAmber: 40,
  productivityLostGreen: 2, productivityLostAmber: 5,
  shortDayMinutes: 5,
  frequentPunchCount: 3,
  graceMinutes: 10,
};

export function getThresholds(): Thresholds {
  if (typeof window === 'undefined') return DEFAULT_THRESHOLDS;
  const raw = localStorage.getItem(KEY);
  if (!raw) return DEFAULT_THRESHOLDS;
  try {
    return { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

export function saveThresholds(t: Thresholds): void {
  localStorage.setItem(KEY, JSON.stringify(t));
}
