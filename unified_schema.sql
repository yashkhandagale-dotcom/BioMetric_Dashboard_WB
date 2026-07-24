-- ═══════════════════════════════════════════════════════════════════════════
-- BioMetric Dashboard + Leave Tracker — UNIFIED Supabase schema
-- Run this ONCE in a BRAND NEW, empty Supabase project's SQL Editor.
-- Do NOT run this against either existing project — it will collide with
-- what's already there. This is for the new project only.
--
-- Architecture decision (see PROGRESS.md / chat log for full reasoning):
--   - `employees` = Leave Tracker's existing model (uuid pk, globally-unique
--     employee_code — confirmed safe: no office ever reuses another
--     office's code), extended with `is_deleted` / `deleted_at` for the
--     Dashboard's "hide from charts" use case, kept deliberately separate
--     from `employment_status` (HR/leave semantics) so the two concepts
--     never collide.
--   - `office_code` (Dashboard) and `office` (Leave Tracker) were the same
--     concept under two names. Kept as `office` here (Leave Tracker's name)
--     since Leave Tracker has far more code/SQL depending on its exact
--     shape — the Dashboard's smaller data-access layer adapts instead.
--   - `custom_departments` is kept as a shared department-name dropdown
--     list, used by both apps.
--   - Dashboard's `employees` / department-override table from the old
--     two-DB setup is GONE — department now lives in exactly one place.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Employee identity (single source of truth)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists employees (
  id uuid not null default gen_random_uuid(),
  auth_user_id uuid unique,
  employee_code text not null unique,
  full_name text not null,
  email text unique,
  role text not null check (role = any (array['employee'::text, 'tech_lead'::text, 'manager'::text, 'hr'::text, 'hr_super_admin'::text])),
  department text not null,
  office text not null,
  reporting_tech_lead_id uuid,
  reporting_manager_id uuid,
  date_of_joining date,
  date_of_exit date,
  employment_status text not null default 'active'::text check (employment_status = any (array['probation'::text, 'active'::text, 'notice_period'::text, 'exited'::text])),
  notice_period_days integer default 30,
  -- New columns for the Dashboard's "hidden from charts/tables/exports"
  -- concept — deliberately independent of employment_status (see header).
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employees_pkey primary key (id),
  constraint employees_reporting_tech_lead_id_fkey foreign key (reporting_tech_lead_id) references employees(id),
  constraint employees_reporting_manager_id_fkey foreign key (reporting_manager_id) references employees(id)
);
create index if not exists idx_employees_office on employees(office);
create index if not exists idx_employees_department on employees(department);

create table if not exists custom_departments (
  name text not null,
  created_at timestamptz not null default now(),
  constraint custom_departments_pkey primary key (name)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Leave Tracker tables (unchanged from the live Leave Tracker
-- project — all FK into employees.id above, which now IS the shared table)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists leave_types (
  id uuid not null default gen_random_uuid(),
  code text not null unique check (code = any (array['SL'::text, 'CL'::text, 'PL'::text, 'LWP'::text])),
  display_name text not null,
  annual_quota numeric not null,
  max_consecutive_days integer,
  min_notice_days_tier jsonb,
  requires_certificate_after_days integer,
  is_directly_applicable boolean not null default true,
  created_at timestamptz not null default now(),
  constraint leave_types_pkey primary key (id)
);

create table if not exists leave_balances (
  id uuid not null default gen_random_uuid(),
  employee_id uuid not null,
  leave_type_id uuid not null,
  fy_start_year integer not null,
  opening_balance numeric not null default 0,
  accrued numeric not null default 0,
  used numeric not null default 0,
  manual_adjustment numeric not null default 0,
  closing_balance numeric generated always as (((opening_balance + accrued) + manual_adjustment) - used) stored,
  updated_at timestamptz not null default now(),
  constraint leave_balances_pkey primary key (id),
  constraint leave_balances_employee_id_fkey foreign key (employee_id) references employees(id),
  constraint leave_balances_leave_type_id_fkey foreign key (leave_type_id) references leave_types(id)
);

create table if not exists balance_transactions (
  id uuid not null default gen_random_uuid(),
  leave_balance_id uuid not null,
  delta numeric not null,
  reason text not null check (reason = any (array['comp_off_credit'::text, 'hr_manual_adjustment'::text, 'carry_forward'::text, 'encashment'::text, 'lapse'::text, 'leave_approved'::text, 'leave_cancelled'::text, 'lwp_conversion'::text, 'pro_ration_initial'::text, 'opening_balance_seed'::text])),
  reference_id uuid,
  created_by uuid,
  note text,
  created_at timestamptz not null default now(),
  constraint balance_transactions_pkey primary key (id),
  constraint balance_transactions_leave_balance_id_fkey foreign key (leave_balance_id) references leave_balances(id),
  constraint balance_transactions_created_by_fkey foreign key (created_by) references employees(id)
);

create table if not exists statutory_leave_records (
  id uuid not null default gen_random_uuid(),
  employee_id uuid not null,
  leave_category text not null check (leave_category = any (array['maternity'::text, 'paternity'::text])),
  event_date date not null,
  child_sequence_number integer,
  entitled_days numeric not null,
  days_taken numeric not null default 0,
  start_date date,
  end_date date,
  eligibility_verified boolean not null default false,
  lifetime_use_number integer,
  approved_by uuid,
  created_at timestamptz not null default now(),
  constraint statutory_leave_records_pkey primary key (id),
  constraint statutory_leave_records_employee_id_fkey foreign key (employee_id) references employees(id),
  constraint statutory_leave_records_approved_by_fkey foreign key (approved_by) references employees(id)
);

create table if not exists leave_requests (
  id uuid not null default gen_random_uuid(),
  employee_id uuid not null,
  leave_type_id uuid not null,
  start_date date not null,
  end_date date not null,
  is_half_day boolean not null default false,
  half_day_session text check (half_day_session = any (array['AM'::text, 'PM'::text])),
  total_days numeric not null,
  reason text not null,
  action_plan text,
  status text not null default 'pending'::text check (status = any (array['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text, 'auto_lwp'::text])),
  source text not null default 'employee_apply'::text check (source = any (array['employee_apply'::text, 'hr_manual'::text])),
  medical_certificate_url text,
  is_lwp_override boolean not null default false,
  lwp_override_reason text,
  applied_on timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_requests_pkey primary key (id),
  constraint leave_requests_employee_id_fkey foreign key (employee_id) references employees(id),
  constraint leave_requests_leave_type_id_fkey foreign key (leave_type_id) references leave_types(id)
);

create table if not exists approval_steps (
  id uuid not null default gen_random_uuid(),
  leave_request_id uuid not null,
  approver_id uuid not null,
  approver_role text not null check (approver_role = any (array['tech_lead'::text, 'manager'::text, 'hr'::text])),
  sequence_order integer not null,
  status text not null default 'pending'::text check (status = any (array['pending'::text, 'approved'::text, 'rejected'::text, 'skipped'::text])),
  comment text,
  acted_on timestamptz,
  created_at timestamptz not null default now(),
  constraint approval_steps_pkey primary key (id),
  constraint approval_steps_leave_request_id_fkey foreign key (leave_request_id) references leave_requests(id),
  constraint approval_steps_approver_id_fkey foreign key (approver_id) references employees(id)
);

create table if not exists workforce_events (
  id uuid not null default gen_random_uuid(),
  employee_id uuid not null,
  event_type text not null check (event_type = any (array['wfh'::text, 'business_travel'::text, 'office_shutdown'::text])),
  event_date date not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint workforce_events_pkey primary key (id),
  constraint workforce_events_employee_id_fkey foreign key (employee_id) references employees(id),
  constraint workforce_events_created_by_fkey foreign key (created_by) references employees(id)
);

-- Staging table used by the Leave Tracker's existing migration tooling —
-- carried over as-is in case a migration job still targets it.
create table if not exists staging_existing_employees (
  id bigint generated always as identity not null,
  employee_code text not null,
  office_code text not null,
  employee_name text not null,
  department text,
  is_deleted boolean not null default false,
  migrated boolean not null default false,
  constraint staging_existing_employees_pkey primary key (id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Dashboard tables (unchanged from the live Dashboard project,
-- minus its own `employees` / department-override table — superseded by
-- SECTION 1 above)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists uploaded_months (
  key text not null,
  label text not null,
  office_code text not null,
  month text not null,
  year text not null,
  created_at timestamptz not null default now(),
  constraint uploaded_months_pkey primary key (key)
);

create table if not exists attendance_records (
  id bigint generated always as identity not null,
  month_key text not null references uploaded_months(key) on delete cascade,
  employee_code text not null,
  employee_name text not null,
  department text not null,
  date text not null,
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
  constraint attendance_records_pkey primary key (id),
  unique (employee_code, date, office_code)
);
create index if not exists idx_attendance_month on attendance_records(month_key);
create index if not exists idx_attendance_office_date on attendance_records(office_code, date);

create table if not exists column_mappings (
  office_code text not null,
  mapping jsonb not null,
  updated_at timestamptz not null default now(),
  constraint column_mappings_pkey primary key (office_code)
);

-- Legacy dashboard-side leave table — NOT confirmed dead yet (that's a
-- Sprint 5 cleanup task, not decided here). Carried over unchanged so
-- nothing breaks if something still reads/writes it.
create table if not exists leave_records (
  id bigint generated always as identity not null,
  month_key text not null,
  employee_code text not null,
  office_code text not null,
  date text not null,
  leave_type text not null,
  half_day_leave_type text,
  marked_by text,
  marked_at timestamptz not null default now(),
  note text,
  constraint leave_records_pkey primary key (id),
  unique (employee_code, date)
);
create index if not exists idx_leave_month on leave_records(month_key);

create table if not exists custom_holidays (
  id bigint generated always as identity not null,
  office_code text not null,
  year text not null,
  date text not null,
  name text not null,
  constraint custom_holidays_pkey primary key (id),
  unique (office_code, year, date)
);

create table if not exists dashboard_settings (
  id int not null default 1 check (id = 1),
  thresholds jsonb not null,
  updated_at timestamptz not null default now(),
  constraint dashboard_settings_pkey primary key (id)
);

create table if not exists shared_links (
  token uuid not null default gen_random_uuid(),
  data jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint shared_links_pkey primary key (token)
);
create index if not exists idx_shared_links_expiry on shared_links(expires_at);

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
-- SECTION 4 — Row Level Security (matches the convention both original
-- schemas used: authenticated-only read/write, except shared_links which
-- is deliberately open for the token-gated manager view)
-- ═══════════════════════════════════════════════════════════════════════════

alter table employees enable row level security;
alter table custom_departments enable row level security;
alter table leave_types enable row level security;
alter table leave_balances enable row level security;
alter table balance_transactions enable row level security;
alter table statutory_leave_records enable row level security;
alter table leave_requests enable row level security;
alter table approval_steps enable row level security;
alter table workforce_events enable row level security;
alter table staging_existing_employees enable row level security;
alter table uploaded_months enable row level security;
alter table attendance_records enable row level security;
alter table column_mappings enable row level security;
alter table leave_records enable row level security;
alter table custom_holidays enable row level security;
alter table dashboard_settings enable row level security;
alter table shared_links enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'employees','custom_departments','leave_types','leave_balances',
    'balance_transactions','statutory_leave_records','leave_requests',
    'approval_steps','workforce_events','staging_existing_employees',
    'uploaded_months','attendance_records','column_mappings',
    'leave_records','custom_holidays','dashboard_settings'
  ]
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

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'shared_links' and policyname = 'authenticated insert') then
    create policy "authenticated insert" on shared_links
      for insert with check (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shared_links' and policyname = 'anyone can read by token') then
    create policy "anyone can read by token" on shared_links
      for select using (true);
  end if;
end $$;