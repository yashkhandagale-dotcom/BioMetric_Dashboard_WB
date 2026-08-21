-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0015 — Attendance Exception Self-Resolution + Escalation
-- (MASTER_PLAN_CONSOLIDATED.md, Part C).
--
-- Turns attendance_exceptions from an HR-only review queue into a
-- self-serve flow: the employee resolves their own flagged day
-- (missed punch / actual half day / early-leave-regularise), with
-- manager approval where a leave balance is affected, and a two-stage
-- escalation-to-LWP mechanism when nobody acts in time. See §C.3/§C.5
-- of the master plan for the full design.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------
-- 1. attendance_exceptions — employee's own resolution choice.
--    'employee_choice IS NULL' is the definition of "unmarked" (§C.2):
--    the moment an employee picks an option a record exists (this
--    column gets set), even while the linked request/regularisation is
--    still awaiting manager approval. resolution stays 'pending' until
--    that decision lands; it only reaches a terminal value ('lwp') via
--    escalation (§C.5) — approved half-days/regularisations are tracked
--    on their own linked rows, not by flipping this column early.
-- ---------------------------------------------------------------------
alter table attendance_exceptions
  add column if not exists employee_choice text
    check (employee_choice in ('missed_punch', 'half_day', 'regularise')),
  add column if not exists employee_note text,
  add column if not exists regularisation_id uuid;

-- resolution enum gains one terminal value: 'lwp' (auto-conversion via
-- escalation). Postgres has no "add value to existing check constraint"
-- shortcut — drop and recreate with the same name, widened.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'attendance_exceptions_resolution_check'
  ) then
    alter table attendance_exceptions drop constraint attendance_exceptions_resolution_check;
  end if;
  alter table attendance_exceptions
    add constraint attendance_exceptions_resolution_check
    check (resolution = any (array['pending'::text, 'half_day'::text, 'missed_punch'::text, 'ignored'::text, 'leave_recorded'::text, 'lwp'::text]));
end $$;

-- ---------------------------------------------------------------------
-- 2. leave_regularisations — gains an employee-initiated direction.
--    Existing manager-unilateral rows ("the manager doing it IS the
--    approval") keep working unchanged: status defaults to 'approved'
--    so nothing already in production needs backfilling. Employee-
--    initiated rows (via the new /leave/me flow) are inserted with
--    status='pending' and requested_by = the employee, and require a
--    manager decision through the new approve/reject routes before
--    they count as resolved.
-- ---------------------------------------------------------------------
alter table leave_regularisations
  add column if not exists status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  add column if not exists requested_by uuid references employees(id) on delete set null;

-- Back-fill the forward reference from attendance_exceptions now that
-- leave_regularisations definitely has an id column to point at
-- (deferred so migration order — 0007 vs 0012 — never matters here).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_exceptions_regularisation_id_fkey'
  ) then
    alter table attendance_exceptions
      add constraint attendance_exceptions_regularisation_id_fkey
      foreign key (regularisation_id) references leave_regularisations(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. escalation_reminders — one shape for both escalation stages
--    (§C.5), rather than duplicating reminder_count/last_reminder_at
--    across attendance_exceptions/leave_requests/leave_regularisations.
--    A single row per (target_type, target_id) is incremented by
--    whichever path fires first — the daily cron or a manual "Remind
--    now" button — so there is never a second counter to reconcile.
-- ---------------------------------------------------------------------
create table if not exists escalation_reminders (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in (
    'attendance_exception_unmarked',   -- stage A: employee hasn't chosen yet
    'leave_request_pending',           -- stage B: half-day awaiting manager
    'regularisation_pending'           -- stage B: regularise awaiting manager
  )),
  target_id uuid not null,
  reminder_count integer not null default 0,
  last_reminder_at timestamptz,
  acked_by uuid references employees(id) on delete set null,
  acked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (target_type, target_id)
);

create index if not exists idx_escalation_reminders_target on escalation_reminders(target_type, target_id);
create index if not exists idx_escalation_reminders_pending on escalation_reminders(target_type) where acked_at is null;

alter table escalation_reminders enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'escalation_reminders' and policyname = 'authenticated read/write'
  ) then
    create policy "authenticated read/write" on escalation_reminders
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

create index if not exists idx_attendance_exceptions_employee_choice on attendance_exceptions(employee_choice);
create index if not exists idx_leave_regularisations_status on leave_regularisations(status);
