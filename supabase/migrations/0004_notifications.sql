-- =====================================================================
-- WonderBiz Leave Management System — Notifications
-- Migration: 004_notifications.sql
--
-- Backs lib/leaveSupabase/notifyLeaveEvent.ts — the single fan-out
-- function every leave-mutation path (self_apply, manager_approval,
-- manager_reject, hr_manual, cancellation) goes through, per
-- LEAVE_TRACKER_OVERHAUL_PLAN.md section 6's notification matrix.
--
-- SCOPE NOTE: this is the in-app half only (a row per recipient). The
-- plan's confirmed assumption #4 also asks for email sending from the
-- start (Sprint D) — that needs a provider (Resend/SendGrid/etc.) picked
-- and its API key added to .env, which isn't available in this
-- environment. notifyLeaveEvent.ts's `// EMAIL:` comments mark exactly
-- where that would plug in once a provider is chosen.
--
-- Run this in the same (unified) Supabase project as
-- 001_leave_management_schema.sql / 002_leave_policy_functions.sql /
-- 003_leave_recording_functions.sql.
-- =====================================================================

create table if not exists notifications (
    id                    uuid primary key default gen_random_uuid(),
    recipient_employee_id uuid not null references employees(id),
    type                  text not null check (type in
                              ('leave_submitted', 'leave_approved', 'leave_rejected', 'leave_cancelled')),
    title                 text not null,
    body                  text not null,
    leave_request_id      uuid references leave_requests(id),
    is_read               boolean not null default false,
    created_at            timestamptz not null default now()
);

create index if not exists idx_notifications_recipient
    on notifications(recipient_employee_id, is_read, created_at desc);

-- Same wide-open "authenticated read/write" posture as every other table
-- in this project today (see getCurrentEmployee.ts's own note that RLS
-- tightening is real, separate work flagged for Sprint G) — every write
-- path here already goes through the service-role client in
-- notifyLeaveEvent.ts regardless, so this doesn't widen anything that
-- wasn't already this permissive.
alter table notifications enable row level security;
drop policy if exists "authenticated read/write notifications" on notifications;
create policy "authenticated read/write notifications" on notifications
    for all
    using (auth.role() = 'authenticated')
    with check (auth.role() = 'authenticated');