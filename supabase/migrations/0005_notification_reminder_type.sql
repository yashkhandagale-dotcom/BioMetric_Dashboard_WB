-- =====================================================================
-- WonderBiz Leave Management System — Reminder notifications
-- Migration: 005_notification_reminder_type.sql
--
-- Adds 'leave_reminder' to notifications.type's check constraint so the
-- new "Send Reminder" action (lib/leaveSupabase/notifyLeaveEvent.ts's
-- sendLeaveReminder, wired to app/api/leave/remind) can insert rows the
-- same way every other event type already does, instead of a separate
-- ad-hoc table. Two shapes reuse this one type:
--   - A pending leave request sitting unapproved past a reasonable
--     window — reminds BOTH the employee (their request is still
--     waiting) and their effective approver (manager, or lead when the
--     department has no manager — see getEffectiveApproverId).
--   - A day with no leave application at all from the employee (an
--     unresolved absence/possible-half-day) — reminds the employee to
--     apply, and their effective approver that nothing has been filed.
--
-- Run after 004_notifications.sql, in the same Supabase project.
-- =====================================================================

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
    check (type in
        ('leave_submitted', 'leave_approved', 'leave_rejected', 'leave_cancelled', 'leave_reminder'));
