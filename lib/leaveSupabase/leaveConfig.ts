import type { SupabaseClient } from '@supabase/supabase-js';

// =====================================================================
// leaveConfig — backs the new "Leave Configuration" HR page
// (app/leave/admin/config). Reads/writes the two things that used to be
// hardcoded in lib/leavePolicy.ts / the fn_check_planned_leave_notice
// SQL function:
//   - leave_policy_config: probation unlock months, default notice-period days
//   - leave_types: annual_quota, max_consecutive_days, min_notice_days_tier,
//     requires_certificate_after_days (these columns already existed in
//     the original schema — this is the first UI to actually edit them)
//   - leave_type_thresholds: weekly alert threshold per leave type (item #4)
// =====================================================================

export interface LeavePolicyConfig {
  probationUnlockMonths: number;
  noticePeriodDefaultDays: number;
  // Reminder scheduling (migration 0018) — see attendanceEscalation.ts's
  // sendEscalationReminder for how these three are actually applied.
  reminderIntervalHours: number; // automated sweep cadence, default 48
  finalReminderDay: number; // day-of-month guaranteed final nudge, default 25
  manualReminderCooldownHours: number; // HR "Remind" button gate, default 24
}

export interface NoticeTier {
  maxDays: number | null; // null = "everything beyond the previous tier"
  noticeDays: number;
}

export interface LeaveTypeConfig {
  id: string;
  code: string;
  displayName: string;
  annualQuota: number;
  maxConsecutiveDays: number | null;
  minNoticeDaysTier: NoticeTier[] | null; // only meaningful for PL today, but not hardcoded to PL
  requiresCertificateAfterDays: number | null;
  weeklyThreshold: number;
  alertEnabled: boolean;
}

export async function getLeavePolicyConfig(
  supabase: SupabaseClient
): Promise<{ config: LeavePolicyConfig; error: string | null }> {
  const { data, error } = await supabase
    .from('leave_policy_config')
    .select('probation_unlock_months, notice_period_default_days, reminder_interval_hours, final_reminder_day, manual_reminder_cooldown_hours')
    .eq('id', 1)
    .single();
  if (error || !data) {
    // Same defaults the old hardcoded lib/leavePolicy.ts used — a missing
    // config row should degrade to the old behavior, not break the app.
    return {
      config: {
        probationUnlockMonths: 4,
        noticePeriodDefaultDays: 30,
        reminderIntervalHours: 48,
        finalReminderDay: 25,
        manualReminderCooldownHours: 24,
      },
      error: error?.message ?? null,
    };
  }
  return {
    config: {
      probationUnlockMonths: data.probation_unlock_months,
      noticePeriodDefaultDays: data.notice_period_default_days,
      reminderIntervalHours: data.reminder_interval_hours ?? 48,
      finalReminderDay: data.final_reminder_day ?? 25,
      manualReminderCooldownHours: data.manual_reminder_cooldown_hours ?? 24,
    },
    error: null,
  };
}

export async function updateLeavePolicyConfig(
  supabase: SupabaseClient,
  updates: Partial<LeavePolicyConfig>,
  updatedBy: string | null
): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: updatedBy };
  if (updates.probationUnlockMonths !== undefined) patch.probation_unlock_months = updates.probationUnlockMonths;
  if (updates.noticePeriodDefaultDays !== undefined) patch.notice_period_default_days = updates.noticePeriodDefaultDays;
  if (updates.reminderIntervalHours !== undefined) patch.reminder_interval_hours = updates.reminderIntervalHours;
  if (updates.finalReminderDay !== undefined) patch.final_reminder_day = updates.finalReminderDay;
  if (updates.manualReminderCooldownHours !== undefined) patch.manual_reminder_cooldown_hours = updates.manualReminderCooldownHours;
  const { error } = await supabase.from('leave_policy_config').update(patch).eq('id', 1);
  return { error: error?.message ?? null };
}

export async function getLeaveTypeConfigs(
  supabase: SupabaseClient
): Promise<{ types: LeaveTypeConfig[]; error: string | null }> {
  const [{ data: types, error: typesError }, { data: thresholds, error: threshError }] = await Promise.all([
    supabase
      .from('leave_types')
      .select('id, code, display_name, annual_quota, max_consecutive_days, min_notice_days_tier, requires_certificate_after_days')
      .order('code'),
    supabase.from('leave_type_thresholds').select('leave_type_id, weekly_count_threshold, alert_enabled'),
  ]);
  const firstError = typesError || threshError;
  if (firstError) return { types: [], error: firstError.message };

  const threshByType = new Map((thresholds ?? []).map((t) => [t.leave_type_id, t]));

  return {
    types: (types ?? []).map((t) => {
      const th = threshByType.get(t.id);
      return {
        id: t.id,
        code: t.code,
        displayName: t.display_name,
        annualQuota: t.annual_quota,
        maxConsecutiveDays: t.max_consecutive_days,
        minNoticeDaysTier: normalizeTier(t.min_notice_days_tier),
        requiresCertificateAfterDays: t.requires_certificate_after_days,
        weeklyThreshold: th?.weekly_count_threshold ?? 5,
        alertEnabled: th?.alert_enabled ?? false,
      };
    }),
    error: null,
  };
}

function normalizeTier(raw: unknown): NoticeTier[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .map((r) => {
      if (typeof r !== 'object' || r === null) return null;
      const obj = r as Record<string, unknown>;
      const noticeDays = Number(obj.notice_days ?? obj.noticeDays);
      if (Number.isNaN(noticeDays)) return null;
      const maxDaysRaw = obj.max_days ?? obj.maxDays;
      const maxDays = maxDaysRaw === null || maxDaysRaw === undefined ? null : Number(maxDaysRaw);
      return { maxDays: maxDays === null || Number.isNaN(maxDays) ? null : maxDays, noticeDays };
    })
    .filter((t): t is NoticeTier => t !== null);
}

export interface LeaveTypeConfigUpdate {
  id: string;
  annualQuota?: number;
  maxConsecutiveDays?: number | null;
  minNoticeDaysTier?: NoticeTier[] | null;
  requiresCertificateAfterDays?: number | null;
  weeklyThreshold?: number;
  alertEnabled?: boolean;
}

export async function updateLeaveTypeConfig(
  supabase: SupabaseClient,
  update: LeaveTypeConfigUpdate,
  updatedBy: string | null
): Promise<{ error: string | null }> {
  const typePatch: Record<string, unknown> = {};
  if (update.annualQuota !== undefined) typePatch.annual_quota = update.annualQuota;
  if (update.maxConsecutiveDays !== undefined) typePatch.max_consecutive_days = update.maxConsecutiveDays;
  if (update.minNoticeDaysTier !== undefined) {
    typePatch.min_notice_days_tier = update.minNoticeDaysTier
      ? update.minNoticeDaysTier.map((t) => ({ max_days: t.maxDays, notice_days: t.noticeDays }))
      : null;
  }
  if (update.requiresCertificateAfterDays !== undefined) {
    typePatch.requires_certificate_after_days = update.requiresCertificateAfterDays;
  }

  if (Object.keys(typePatch).length > 0) {
    const { error } = await supabase.from('leave_types').update(typePatch).eq('id', update.id);
    if (error) return { error: error.message };
  }

  if (update.weeklyThreshold !== undefined || update.alertEnabled !== undefined) {
    const threshPatch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: updatedBy };
    if (update.weeklyThreshold !== undefined) threshPatch.weekly_count_threshold = update.weeklyThreshold;
    if (update.alertEnabled !== undefined) threshPatch.alert_enabled = update.alertEnabled;
    const { error } = await supabase
      .from('leave_type_thresholds')
      .upsert({ leave_type_id: update.id, ...threshPatch }, { onConflict: 'leave_type_id' });
    if (error) return { error: error.message };
  }

  return { error: null };
}
