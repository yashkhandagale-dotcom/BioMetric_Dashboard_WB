-- Migration: 0014_fnf_calculations.sql
-- F&F (Full & Final) Calculator — audit table only. All the day/leave
-- math is computed in lib/leaveSupabase/fnfCalculator.ts at request
-- time (plain TS, not a Postgres RPC function) — deliberately avoids
-- the RPC schema-cache issue already hit once (see 0009's header:
-- "Could not find the function ... in the schema cache").
--
-- Run this against the LIVE (unified) Supabase project, same as 0007-0013.
-- ALSO add this table to unified_schema.sql (the file that actually
-- stands up a fresh environment) — see unified_schema.sql's own header
-- for why both copies must stay in sync.

create table if not exists fnf_calculations (
    id                  uuid primary key default gen_random_uuid(),
    employee_id         uuid not null references employees(id),
    last_working_day    date not null,
    payable_days        integer not null,
    payable_leaves      numeric(5,2) not null,
    calculation_detail  jsonb not null,
    calculated_by       uuid not null references employees(id),
    calculated_at       timestamptz not null default now()
);

create index if not exists idx_fnf_calculations_employee on fnf_calculations(employee_id);

comment on table fnf_calculations is
    'Audit trail for HR-run F&F day/leave calculations. calculation_detail holds the full breakdown so a number can be reconstructed later if questioned — the two summary columns are for quick listing only.';

-- RLS: same "authenticated read/write" convention every other table in
-- this schema uses (see unified_schema.sql Section 4's do-loop) — missed
-- in the original migration, which caused inserts to fail with
-- "new row violates row-level security policy" the first time HR ran a
-- calculation, since RLS on this project is enabled by default and no
-- policy existed for this table yet.
alter table fnf_calculations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'fnf_calculations' and policyname = 'authenticated read/write'
  ) then
    create policy "authenticated read/write" on fnf_calculations
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;
