-- ═══════════════════════════════════════════════════════════════════════════
-- BioMetric Dashboard — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Project → SQL Editor
-- → New query → paste → Run).
--
-- Model: single shared HR workspace. Every signed-in user (created via
-- Supabase Auth) can read/write all rows — this mirrors the current app's
-- behaviour where all HR staff share one browser's localStorage. If you
-- later want per-office or per-user isolation, add an `owner_id` column and
-- tighten the RLS policies below.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Uploaded months (one row per office+month+year CSV import) ──────────────
create table if not exists uploaded_months (
  key text primary key,              -- e.g. "2026_01_MUM"
  label text not null,
  office_code text not null,
  month text not null,
  year text not null,
  created_at timestamptz not null default now()
);

-- ── Attendance records ───────────────────────────────────────────────────────
create table if not exists attendance_records (
  id bigint generated always as identity primary key,
  month_key text not null references uploaded_months(key) on delete cascade,
  employee_code text not null,
  employee_name text not null,
  department text not null,
  date text not null,                -- YYYY-MM-DD
  in_time text,
  out_time text,
  status text,
  punch_records text,
  late_by text,
  early_by text,
  overtime text,
  duration text,
  office_code text not null,
  punch_count int,
  is_short_day boolean,
  extra_fields jsonb,
  late_is_estimated boolean,
  early_is_estimated boolean,
  updated_at timestamptz not null default now(),
  unique (employee_code, date, office_code)
);
create index if not exists idx_attendance_month on attendance_records(month_key);
create index if not exists idx_attendance_office_date on attendance_records(office_code, date);

-- ── Column mappings (one per office) ─────────────────────────────────────────
create table if not exists column_mappings (
  office_code text primary key,
  mapping jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── Leave records ─────────────────────────────────────────────────────────────
create table if not exists leave_records (
  id bigint generated always as identity primary key,
  month_key text not null,
  employee_code text not null,
  office_code text not null,
  date text not null,
  leave_type text not null,
  half_day_leave_type text,
  marked_by text,
  marked_at timestamptz not null default now(),
  note text,
  unique (employee_code, date)
);
create index if not exists idx_leave_month on leave_records(month_key);

-- ── Custom (HR-added) holidays — predefined ones stay hardcoded in code ─────
create table if not exists custom_holidays (
  id bigint generated always as identity primary key,
  office_code text not null,
  year text not null,
  date text not null,
  name text not null,
  unique (office_code, year, date)
);

-- ── Dashboard thresholds — single shared settings row ────────────────────────
create table if not exists dashboard_settings (
  id int primary key default 1,
  thresholds jsonb not null,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

-- ── Shared-link tokens (replaces the old in-memory Map, which reset on every
--    serverless cold start / multi-instance deploy) ─────────────────────────
create table if not exists shared_links (
  token uuid primary key default gen_random_uuid(),
  data jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_shared_links_expiry on shared_links(expires_at);

-- ── Employees (HR directory: department overrides + soft-delete) ───────────
-- lib/employeeStore.ts reads/writes this table directly (loadEmployeeDirectory,
-- setEmployeeDepartment, deleteEmployee, restoreEmployee) but no `create table`
-- for it ever existed in this file — see PROGRESS.md Sprint 1/2 for how that
-- was found. `if not exists` makes this safe to run whether the table is
-- genuinely missing from your live project, or was already created there by
-- hand (e.g. via the Table Editor) before this migration existed.
--
-- IMPORTANT: if `employees` already exists in your live project with a
-- different column set than below, this statement will silently do nothing
-- (no error, no columns added/changed) — reconcile manually against the
-- columns lib/employeeStore.ts writes: employee_code, office_code,
-- employee_name, department, is_deleted, deleted_at, updated_at.
create table if not exists employees (
  employee_code text not null,
  office_code text not null,
  employee_name text,
  department text,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ── Custom (HR-added) departments ───────────────────────────────────────────
create table if not exists custom_departments (
  name text primary key
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security — every table requires an authenticated Supabase session
-- except shared_links, which is deliberately opened up for the token-gated
-- manager read-only view (no login for managers, by design — see FR-10 in
-- the app's README).
-- ═══════════════════════════════════════════════════════════════════════════

alter table uploaded_months enable row level security;
alter table attendance_records enable row level security;
alter table column_mappings enable row level security;
alter table leave_records enable row level security;
alter table custom_holidays enable row level security;
alter table dashboard_settings enable row level security;
alter table shared_links enable row level security;
alter table employees enable row level security;
alter table custom_departments enable row level security;

create policy "authenticated read/write" on uploaded_months
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on attendance_records
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on column_mappings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on leave_records
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on custom_holidays
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on dashboard_settings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on employees
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on custom_departments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- shared_links: HR (authenticated) can insert; the read-only manager link
-- (anon, token in URL) must be able to select by exact token. Server-side API
-- routes use the service-role key anyway (bypasses RLS), so these are a
-- defense-in-depth backstop, not the primary access control.
create policy "authenticated insert" on shared_links
  for insert with check (auth.role() = 'authenticated');
create policy "anyone can read by token" on shared_links
  for select using (true);

insert into dashboard_settings (id, thresholds)
values (1, '{
  "attendanceRateGreen": 80, "attendanceRateAmber": 70,
  "absenteeismRateGreen": 20, "absenteeismRateAmber": 30,
  "avgHoursPctGreen": 85, "avgHoursPctAmber": 75,
  "lateRateGreen": 10, "lateRateAmber": 20,
  "earlyRateGreen": 15, "earlyRateAmber": 40,
  "productivityLostGreen": 2, "productivityLostAmber": 5,
  "shortDayMinutes": 5, "frequentPunchCount": 3, "graceMinutes": 10,
  "shiftStartMinutes": 570, "shiftEndMinutes": 1110
}'::jsonb)
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: scope employee identity per office, not globally.
-- Employee codes (e.g. 257, 270) are only unique WITHIN an office in this
-- shared multi-office workspace. If the `employees` table's unique
-- constraint / upsert conflict target is on employee_code alone, a delete
-- or department reassignment in one office can silently apply to a
-- different employee in another office who happens to share the same code.
-- Run this once against your existing `employees` table.
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the old employee_code-only uniqueness (name may differ — check with
-- \d employees in psql, or the Supabase Table Editor's "Indexes" tab, and
-- adjust the constraint name below before running).
-- alter table employees drop constraint employees_employee_code_key;

-- Wrapped in a DO block (rather than a bare ALTER TABLE) so this is safe to
-- run whether `employees` is the table this file just created above (no
-- constraint yet) or a pre-existing table this was already run against once.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employees_code_office_unique'
  ) then
    alter table employees
      add constraint employees_code_office_unique unique (employee_code, office_code);
  end if;
end $$;