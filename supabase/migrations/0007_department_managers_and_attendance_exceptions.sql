-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0007 — department_managers (fixes the reported error) +
-- attendance-exception tracking (Today's Absentees / Possible Half Day).
--
-- Run this against the SAME (unified) Supabase project unified_schema.sql
-- was run against.
--
-- ── Why department_managers was "missing" ──────────────────────────────────
-- Every route that reads/writes it (app/leave/admin/page.tsx,
-- app/api/leave/employees/[id]/profile/route.ts, app/api/leave/departments/
-- route.ts) has carried a comment for a while pointing at
-- "supabase-leave/schema.sql's 006_department_managers.sql" — but that file
-- was never actually committed to the repo. The table was evidently created
-- by hand (or on a since-lost branch) directly against a live project and
-- never checked in. This migration is that missing file, finally committed,
-- with the exact shape every caller already assumes:
--   - `department` is the primary key (one manager per department — see the
--     `onConflict: 'department'` upsert in profile/route.ts).
--   - `manager_id` is nullable: unassigning a manager sets it to null rather
--     than deleting the row (see the same file's "toRemove" branch).
--   - A single manager can own multiple departments — that's just multiple
--     rows with the same manager_id, no join table needed.
-- No `teams` table is introduced here. See the note in
-- app/api/leave/employees/route.ts and app/api/leave/departments/route.ts:
-- this codebase deliberately has no separate "team" concept — department
-- IS the grouping, and a prior `teams` table/route was already tried,
-- never migrated, and abandoned in favor of this exact design. Re-adding
-- a team layer here would fork that decision, not fix a bug.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists department_managers (
  department text not null,
  manager_id uuid references employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint department_managers_pkey primary key (department)
);
create index if not exists idx_department_managers_manager on department_managers(manager_id);

alter table department_managers enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'department_managers' and policyname = 'authenticated read/write'
  ) then
    create policy "authenticated read/write" on department_managers
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- attendance_exceptions — one row per (employee, date) that HR has acted on
-- from the "Today's Absentees" / "Possible Half Day / Missed Punch"
-- accordions. This is a review/audit trail, NOT a duplicate of leave data:
--   - A "half_day" resolution does not store leave details here — it points
--     at the real row HR's action created in `leave_requests` (via the
--     existing Record Leave flow, untouched). Balances, approvals, and
--     leave-type logic all still live in exactly one place.
--   - A "missed_punch" resolution points at a row in `missed_punch` below,
--     which explicitly does NOT count as leave (per the requirement that
--     it must not touch leave balances).
--   - An "ignored" resolution has no linked record — it just suppresses the
--     candidate from reappearing for that date.
-- Kept separate from `leave_requests` / `missed_punch` (rather than folding
-- resolution state into either) so a single query can answer "what has HR
-- already looked at for today" without scanning two unrelated tables.
create table if not exists attendance_exceptions (
  id uuid not null default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  exception_date date not null,
  exception_type text not null check (exception_type = any (array['absent'::text, 'possible_half_day'::text, 'missed_punch_detected'::text])),
  first_punch text,
  last_punch text,
  worked_minutes integer,
  resolution text not null default 'pending' check (resolution = any (array['pending'::text, 'half_day'::text, 'missed_punch'::text, 'ignored'::text, 'leave_recorded'::text])),
  resolution_note text,
  leave_request_id uuid references leave_requests(id) on delete set null,
  missed_punch_id uuid,
  resolved_by uuid references employees(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_exceptions_pkey primary key (id),
  constraint attendance_exceptions_unique_per_day unique (employee_id, exception_date)
);
create index if not exists idx_attendance_exceptions_date on attendance_exceptions(exception_date);
create index if not exists idx_attendance_exceptions_resolution on attendance_exceptions(resolution);

-- missed_punch — explicitly NOT leave. Recorded so the day is flagged for
-- payroll/attendance review, without creating a leave_request, without
-- touching any leave_balances row, and without an approval flow.
create table if not exists missed_punch (
  id uuid not null default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  punch_date date not null,
  first_punch text,
  last_punch text,
  note text,
  recorded_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint missed_punch_pkey primary key (id),
  constraint missed_punch_unique_per_day unique (employee_id, punch_date)
);
create index if not exists idx_missed_punch_date on missed_punch(punch_date);

alter table attendance_exceptions enable row level security;
alter table missed_punch enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['attendance_exceptions', 'missed_punch']
  loop
    if not exists (
      select 1 from pg_policies where tablename = t and policyname = 'authenticated read/write'
    ) then
      execute format(
        'create policy "authenticated read/write" on %I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')',
        t
      );
    end if;
  end loop;
end $$;

-- Back-fill the FK now that missed_punch exists (deferred above so
-- attendance_exceptions could be created first without a forward reference
-- ordering problem).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_exceptions_missed_punch_id_fkey'
  ) then
    alter table attendance_exceptions
      add constraint attendance_exceptions_missed_punch_id_fkey
      foreign key (missed_punch_id) references missed_punch(id) on delete set null;
  end if;
end $$;