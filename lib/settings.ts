import { Thresholds } from './types';
import { createClient } from './supabase/client';

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
  shiftStartMinutes: 9 * 60 + 30, // 09:30 — change in Settings if your org's shift differs
  shiftEndMinutes: 18 * 60 + 30,  // 18:30
};

// Single shared row (id=1) — thresholds apply to the whole HR workspace,
// same as before when they lived in one browser's localStorage.
export async function getThresholds(): Promise<Thresholds> {
  const supabase = createClient();
  const { data } = await supabase
    .from('dashboard_settings')
    .select('thresholds')
    .eq('id', 1)
    .maybeSingle();
  if (!data?.thresholds) return DEFAULT_THRESHOLDS;
  return { ...DEFAULT_THRESHOLDS, ...(data.thresholds as Partial<Thresholds>) };
}

export async function saveThresholds(t: Thresholds): Promise<void> {
  const supabase = createClient();
  await supabase
    .from('dashboard_settings')
    .upsert({ id: 1, thresholds: t, updated_at: new Date().toISOString() });
}
