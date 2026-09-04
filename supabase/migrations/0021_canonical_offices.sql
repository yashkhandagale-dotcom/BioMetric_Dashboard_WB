-- 0021_canonical_offices.sql
--
-- Canonical Offices Architecture:
-- 1. Create canonical `offices` table — the single source of truth for office codes.
-- 2. One-time data cleanup: normalize Mumbai -> MUM, Hyderabad -> HYD across all tables.
-- 3. Foreign key constraints on all 5 tables referencing offices:
--    - employees.office
--    - attendance_records.office_code
--    - uploaded_months.office_code
--    - custom_holidays.office_code
--    - column_mappings.office_code

-- ── 1. Create canonical offices table ─────────────────────────────────────────
create table if not exists offices (
  code text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

comment on table offices is 'Single source of truth for physical office locations and their canonical codes.';
comment on column offices.code is 'Canonical 3-character uppercase office code, e.g. MUM, HYD.';
comment on column offices.name is 'Full human-readable office location name, e.g. Mumbai, Hyderabad.';

alter table offices enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'offices' and policyname = 'authenticated read'
  ) then
    create policy "authenticated read" on offices for select using (auth.role() = 'authenticated');
  end if;
  if not exists (
    select 1 from pg_policies where tablename = 'offices' and policyname = 'authenticated write'
  ) then
    create policy "authenticated write" on offices for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- Seed canonical default offices
insert into offices (code, name) values
  ('MUM', 'Mumbai'),
  ('HYD', 'Hyderabad')
on conflict (code) do nothing;

-- ── 2. One-time Data Cleanup & Normalization ─────────────────────────────────
-- Clean up potential key collisions in column_mappings before updating
delete from column_mappings
where lower(trim(office_code)) in ('mumbai')
  and exists (select 1 from column_mappings where office_code = 'MUM');

delete from column_mappings
where lower(trim(office_code)) in ('hyderabad')
  and exists (select 1 from column_mappings where office_code = 'HYD');

-- Clean up potential unique collisions in custom_holidays before updating
delete from custom_holidays ch1
using custom_holidays ch2
where lower(trim(ch1.office_code)) = 'mumbai'
  and ch2.office_code = 'MUM'
  and ch1.year = ch2.year
  and ch1.date = ch2.date;

delete from custom_holidays ch1
using custom_holidays ch2
where lower(trim(ch1.office_code)) = 'hyderabad'
  and ch2.office_code = 'HYD'
  and ch1.year = ch2.year
  and ch1.date = ch2.date;

-- Temporarily disable the specific employees_guard_self_update trigger
-- so this administrative one-time cleanup can normalize office codes without
-- tripping self-update authorization guards or system triggers.
do $$
declare
  t_name text;
begin
  for t_name in (
    select t.tgname
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'employees'::regclass
      and not t.tgisinternal
      and p.proname = 'employees_guard_self_update'
  ) loop
    execute format('alter table employees disable trigger %I', t_name);
  end loop;
end $$;

-- Normalize Mumbai -> MUM across employees
update employees
  set office = 'MUM'
  where lower(trim(office)) in ('mumbai', 'mum') and office <> 'MUM';

-- Normalize Hyderabad -> HYD across employees
update employees
  set office = 'HYD'
  where lower(trim(office)) in ('hyderabad', 'hyd') and office <> 'HYD';

-- Re-enable the employees_guard_self_update trigger
do $$
declare
  t_name text;
begin
  for t_name in (
    select t.tgname
    from pg_proc p
    join pg_trigger t on t.tgfoid = p.oid
    where t.tgrelid = 'employees'::regclass
      and not t.tgisinternal
      and p.proname = 'employees_guard_self_update'
  ) loop
    execute format('alter table employees enable trigger %I', t_name);
  end loop;
end $$;

-- Normalize attendance and configuration tables
update attendance_records
  set office_code = 'MUM'
  where lower(trim(office_code)) in ('mumbai', 'mum') and office_code <> 'MUM';

update attendance_records
  set office_code = 'HYD'
  where lower(trim(office_code)) in ('hyderabad', 'hyd') and office_code <> 'HYD';

update uploaded_months
  set office_code = 'MUM'
  where lower(trim(office_code)) in ('mumbai', 'mum') and office_code <> 'MUM';

update uploaded_months
  set office_code = 'HYD'
  where lower(trim(office_code)) in ('hyderabad', 'hyd') and office_code <> 'HYD';

update custom_holidays
  set office_code = 'MUM'
  where lower(trim(office_code)) in ('mumbai', 'mum') and office_code <> 'MUM';

update custom_holidays
  set office_code = 'HYD'
  where lower(trim(office_code)) in ('hyderabad', 'hyd') and office_code <> 'HYD';

update column_mappings
  set office_code = 'MUM'
  where lower(trim(office_code)) in ('mumbai', 'mum') and office_code <> 'MUM';

update column_mappings
  set office_code = 'HYD'
  where lower(trim(office_code)) in ('hyderabad', 'hyd') and office_code <> 'HYD';

-- ═══════════════════════════════════════════════════════════════════════════
-- TROUBLESHOOTING / DIAGNOSTIC QUERIES:
-- If adding any of the foreign keys below fails with a foreign_key_violation,
-- it means some row has an office value beyond Mumbai/Hyderabad (or MUM/HYD).
-- Run these queries in the Supabase SQL Editor to find the offending values:
--
--   SELECT DISTINCT office FROM employees WHERE office NOT IN (SELECT code FROM offices);
--   SELECT DISTINCT office_code FROM attendance_records WHERE office_code NOT IN (SELECT code FROM offices);
--   SELECT DISTINCT office_code FROM uploaded_months WHERE office_code NOT IN (SELECT code FROM offices);
--   SELECT DISTINCT office_code FROM custom_holidays WHERE office_code NOT IN (SELECT code FROM offices);
--   SELECT DISTINCT office_code FROM column_mappings WHERE office_code NOT IN (SELECT code FROM offices);
--
-- If another office exists (e.g. 'BLR' / 'Bengaluru'), add it to offices first:
--   INSERT INTO offices (code, name) VALUES ('BLR', 'Bengaluru');
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 3. Foreign Key Constraints ───────────────────────────────────────────────

-- employees.office -> offices.code
alter table employees
  drop constraint if exists fk_employees_office,
  add constraint fk_employees_office
    foreign key (office) references offices(code) on update cascade;

-- attendance_records.office_code -> offices.code
alter table attendance_records
  drop constraint if exists fk_attendance_records_office,
  add constraint fk_attendance_records_office
    foreign key (office_code) references offices(code) on update cascade;

-- uploaded_months.office_code -> offices.code
alter table uploaded_months
  drop constraint if exists fk_uploaded_months_office,
  add constraint fk_uploaded_months_office
    foreign key (office_code) references offices(code) on update cascade;

-- custom_holidays.office_code -> offices.code
alter table custom_holidays
  drop constraint if exists fk_custom_holidays_office,
  add constraint fk_custom_holidays_office
    foreign key (office_code) references offices(code) on update cascade;

-- column_mappings.office_code -> offices.code
alter table column_mappings
  drop constraint if exists fk_column_mappings_office,
  add constraint fk_column_mappings_office
    foreign key (office_code) references offices(code) on update cascade;
