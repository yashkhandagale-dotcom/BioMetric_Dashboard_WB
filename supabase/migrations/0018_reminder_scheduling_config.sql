-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0018 — Configurable reminder scheduling.
--
-- Backs the reminder-timing rules requested on top of the Part C
-- escalation system (attendanceEscalation.ts):
--   1. reminder_interval_hours — how often the automated sweep re-nudges
--      an open target (attendance_exception_unmarked /
--      leave_request_pending / regularisation_pending). Default 48h.
--   2. final_reminder_day — for a target whose relevant date falls on or
--      before this day-of-month, a guaranteed reminder fires on this
--      day of that month regardless of the interval cadence (payroll
--      cut-off style final nudge). Default 25 (matches the FY/payroll
--      25th cut-off already used elsewhere in this codebase, e.g.
--      getFYStartYear / the annual-reset cron).
--   3. manual_reminder_cooldown_hours — the minimum gap HR must leave
--      between two manual "Remind" clicks on the same target. Default 24h.
--
-- All three are editable from the existing Leave Configuration page
-- (app/leave/admin/config) — see lib/leaveSupabase/leaveConfig.ts.
-- ═══════════════════════════════════════════════════════════════════════════

alter table leave_policy_config
  add column if not exists reminder_interval_hours integer not null default 48,
  add column if not exists final_reminder_day integer not null default 25
    check (final_reminder_day between 1 and 28),
  add column if not exists manual_reminder_cooldown_hours integer not null default 24;

-- escalation_reminders gains a marker so the final-reminder-day nudge
-- (point 2 above) never double-fires if the automated sweep and a
-- manual click both land on the same calendar day.
alter table escalation_reminders
  add column if not exists last_final_reminder_on date;
