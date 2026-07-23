-- =====================================================================
-- WonderBiz Leave Tracker — schema for its OWN Supabase project.
-- Run this in the LEAVE TRACKER project's SQL Editor — NOT the existing
-- dashboard's project. This project is deliberately separate: different
-- URL, different keys, different everything, so nothing here can ever
-- affect the deployed attendance dashboard's DB.
--
-- Migration: 001_leave_management_schema.sql
--
-- Scope: employees, roles, leave types, balances, transactions,
--        statutory leave (maternity/paternity), leave requests,
--        approval chain.
--
-- Design invariants (do not violate in later migrations):
--   1. leave_balances covers ONLY Sick / Casual / Planned / LWP.
--      Maternity & Paternity live in statutory_leave_records instead,
--      because they don't reset annually or pro-rate.
--   2. Comp-off has no table of its own — it's a balance_transactions
--      row that credits Planned Leave, so it's auditable without being
--      a distinct leave type.
--   3. WFH is NOT a leave type. It lives on attendance_records as a
--      location flag and never touches leave_balances.
--   4. Leave cycle resets every 25 March (WonderBiz FY), not 1 April
--      and not calendar-month boundaries.
-- =====================================================================

-- ---------------------------------------------------------------------
-- EMPLOYEES
-- ---------------------------------------------------------------------
create table if not exists employees (
    id                  uuid primary key default gen_random_uuid(),
    auth_user_id        uuid unique,                 -- links to Supabase auth.users
    employee_code       text unique not null,
    full_name           text not null,
    email               text unique not null,
    role                text not null check (role in
                            ('employee', 'tech_lead', 'manager', 'hr', 'hr_super_admin')),
    department          text not null,
    office               text not null,
    reporting_tech_lead_id uuid references employees(id),
    reporting_manager_id   uuid references employees(id),
    date_of_joining     date not null,
    date_of_exit        date,
    employment_status   text not null default 'active'
                            check (employment_status in
                            ('probation', 'active', 'notice_period', 'exited')),
    notice_period_days  integer default 30,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

comment on column employees.employment_status is
    'Drives probation-block and notice-period LWP rules in the policy engine.';

-- ---------------------------------------------------------------------
-- LEAVE TYPES  (config-driven, not hardcoded — HR can retune quotas)
-- ---------------------------------------------------------------------
create table if not exists leave_types (
    id                  uuid primary key default gen_random_uuid(),
    code                text unique not null check (code in ('SL', 'CL', 'PL', 'LWP')),
    display_name        text not null,
    annual_quota        numeric(5,2) not null,        -- 0 for LWP (uncapped, derived only)
    max_consecutive_days integer,                      -- null = no cap
    min_notice_days_tier jsonb,                         -- e.g. {"<=2":14,"<=7":28,">7":56} for PL
    requires_certificate_after_days integer,            -- 3 for SL
    is_directly_applicable boolean not null default true, -- false for LWP (system-derived only)
    created_at          timestamptz not null default now()
);

insert into leave_types (code, display_name, annual_quota, max_consecutive_days,
                          min_notice_days_tier, requires_certificate_after_days,
                          is_directly_applicable)
values
    ('SL', 'Sick Leave', 5, null, null, 3, true),
    ('CL', 'Casual Leave', 5, null, null, null, true),
    ('PL', 'Planned Leave', 11, null,
        '{"<=2": 14, "<=7": 28, ">7": 56}', null, true),
    ('LWP', 'Leave Without Pay', 0, null, null, null, false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- LEAVE BALANCES  — one row per employee, per leave type, per FY
-- FY key = the year the cycle STARTS, e.g. FY '2025' = 25-Mar-2025 to 24-Mar-2026
-- ---------------------------------------------------------------------
create table if not exists leave_balances (
    id                  uuid primary key default gen_random_uuid(),
    employee_id         uuid not null references employees(id),
    leave_type_id       uuid not null references leave_types(id),
    fy_start_year        integer not null,             -- e.g. 2025
    opening_balance     numeric(5,2) not null default 0,   -- pro-rated or carried-forward
    accrued             numeric(5,2) not null default 0,   -- e.g. probation lump sum, comp-off
    used                numeric(5,2) not null default 0,
    manual_adjustment   numeric(5,2) not null default 0,   -- HR discretionary corrections
    closing_balance     numeric(5,2) generated always as
                            (opening_balance + accrued + manual_adjustment - used) stored,
    updated_at          timestamptz not null default now(),
    unique (employee_id, leave_type_id, fy_start_year)
);

-- ---------------------------------------------------------------------
-- BALANCE TRANSACTIONS — audit trail for every balance mutation
-- (comp-off credits, HR manual adjustments, carry-forward, encashment, lapse)
-- ---------------------------------------------------------------------
create table if not exists balance_transactions (
    id                  uuid primary key default gen_random_uuid(),
    leave_balance_id    uuid not null references leave_balances(id),
    delta               numeric(5,2) not null,          -- positive = credit, negative = debit
    reason              text not null check (reason in
                            ('comp_off_credit', 'hr_manual_adjustment', 'carry_forward',
                             'encashment', 'lapse', 'leave_approved', 'leave_cancelled',
                             'lwp_conversion', 'pro_ration_initial')),
    reference_id        uuid,                            -- e.g. leave_requests.id, when applicable
    created_by           uuid references employees(id),   -- who triggered it (HR / system)
    note                text,
    created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- STATUTORY LEAVE — Maternity / Paternity, separate from the annual cycle
-- ---------------------------------------------------------------------
create table if not exists statutory_leave_records (
    id                  uuid primary key default gen_random_uuid(),
    employee_id         uuid not null references employees(id),
    leave_category      text not null check (leave_category in ('maternity', 'paternity')),
    event_date          date not null,                   -- expected/actual delivery date
    child_sequence_number integer,                        -- for maternity's "3rd child = 12 weeks" rule
    entitled_days        numeric(5,1) not null,            -- computed at creation (see function below)
    days_taken          numeric(5,1) not null default 0,
    start_date           date,
    end_date             date,
    eligibility_verified boolean not null default false,   -- 80-days-worked-in-12-months check (maternity)
    lifetime_use_number  integer,                          -- paternity only: 1st or 2nd use (max 2 ever)
    approved_by          uuid references employees(id),
    created_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- LEAVE REQUESTS
-- ---------------------------------------------------------------------
create table if not exists leave_requests (
    id                  uuid primary key default gen_random_uuid(),
    employee_id         uuid not null references employees(id),
    leave_type_id       uuid not null references leave_types(id),
    start_date          date not null,
    end_date            date not null,
    is_half_day         boolean not null default false,
    half_day_session    text check (half_day_session in ('AM', 'PM')),
    total_days          numeric(5,2) not null,            -- computed by app/policy engine at apply-time
    reason              text not null,
    action_plan         text,                              -- required for planned/non-emergency leave
    status              text not null default 'pending'
                            check (status in
                            ('pending', 'approved', 'rejected', 'cancelled', 'auto_lwp')),
    source              text not null default 'employee_apply'
                            check (source in ('employee_apply', 'hr_manual')),
    medical_certificate_url text,                          -- required if SL > 3 consecutive days
    is_lwp_override      boolean not null default false,    -- true if policy engine force-converted to LWP
    lwp_override_reason  text,
    applied_on           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- APPROVAL STEPS — sequential chain per request (tech lead -> manager -> HR)
-- ---------------------------------------------------------------------
create table if not exists approval_steps (
    id                  uuid primary key default gen_random_uuid(),
    leave_request_id    uuid not null references leave_requests(id),
    approver_id         uuid not null references employees(id),
    approver_role        text not null check (approver_role in ('tech_lead', 'manager', 'hr')),
    sequence_order       integer not null,
    status               text not null default 'pending'
                            check (status in ('pending', 'approved', 'rejected', 'skipped')),
    comment              text,
    acted_on             timestamptz,
    created_at           timestamptz not null default now(),
    unique (leave_request_id, sequence_order)
);

create index if not exists idx_leave_requests_employee on leave_requests(employee_id);
create index if not exists idx_leave_requests_status on leave_requests(status);
create index if not exists idx_approval_steps_approver on approval_steps(approver_id, status);
create index if not exists idx_leave_balances_employee_fy on leave_balances(employee_id, fy_start_year);
-- =====================================================================
-- WonderBiz Leave Management System — Policy Engine Functions
-- Migration: 002_leave_policy_functions.sql
--
-- Encodes the math from the Employee Handbook directly in the DB so
-- balance calculations can't drift from app-layer duplicates.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PRO-RATION AT JOINING
--    total_eligible = (months_remaining_in_FY / 12) * 21
--    Distribution order confirmed from handbook examples: SL first
--    (cap 5), then CL (cap 5), remainder to PL.
--    FY runs 25-Mar to 24-Mar next year.
-- ---------------------------------------------------------------------
create or replace function fn_prorate_new_joiner(p_employee_id uuid, p_doj date)
returns void as $$
declare
    v_fy_start_year   integer;
    v_fy_start_date   date;
    v_months_remaining numeric;
    v_total_eligible  numeric;
    v_sl numeric; v_cl numeric; v_pl numeric;
    v_sl_id uuid; v_cl_id uuid; v_pl_id uuid; v_lwp_id uuid;
    v_balance_id uuid;
begin
    -- Determine which FY window the DOJ falls into (FY key = start year)
    if extract(month from p_doj) > 3
       or (extract(month from p_doj) = 3 and extract(day from p_doj) >= 25) then
        v_fy_start_year := extract(year from p_doj)::integer;
    else
        v_fy_start_year := extract(year from p_doj)::integer - 1;
    end if;
    v_fy_start_date := make_date(v_fy_start_year, 3, 25);

    -- Whole months remaining in the FY from DOJ (handbook examples use
    -- whole-month granularity, e.g. joining in July = 12-3=9 months left)
    v_months_remaining := 12 - (
        (extract(year from p_doj) - extract(year from v_fy_start_date)) * 12
        + (extract(month from p_doj) - extract(month from v_fy_start_date))
    );
    v_months_remaining := greatest(least(v_months_remaining, 12), 0);

    v_total_eligible := round((v_months_remaining / 12.0) * 21, 2);

    -- Distribute: SL first (cap 5), then CL (cap 5), remainder to PL
    v_sl := least(v_total_eligible, 5);
    v_cl := least(greatest(v_total_eligible - v_sl, 0), 5);
    v_pl := greatest(v_total_eligible - v_sl - v_cl, 0);

    select id into v_sl_id from leave_types where code = 'SL';
    select id into v_cl_id from leave_types where code = 'CL';
    select id into v_pl_id from leave_types where code = 'PL';
    select id into v_lwp_id from leave_types where code = 'LWP';

    -- Create balance rows (LWP row created with 0 for consistency/reporting only)
    insert into leave_balances (employee_id, leave_type_id, fy_start_year, opening_balance)
    values
        (p_employee_id, v_sl_id, v_fy_start_year, v_sl),
        (p_employee_id, v_cl_id, v_fy_start_year, v_cl),
        (p_employee_id, v_pl_id, v_fy_start_year, v_pl),
        (p_employee_id, v_lwp_id, v_fy_start_year, 0)
    on conflict (employee_id, leave_type_id, fy_start_year) do nothing;

    -- Audit trail
    for v_balance_id in
        select id from leave_balances
        where employee_id = p_employee_id and fy_start_year = v_fy_start_year
    loop
        insert into balance_transactions (leave_balance_id, delta, reason, created_by, note)
        values (v_balance_id, 0, 'pro_ration_initial', null,
                format('Initial pro-ration on joining %s: %s months remaining in FY%s',
                        p_doj, v_months_remaining, v_fy_start_year));
    end loop;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 2. PROBATION ACCRUAL
--    Months 1-3: accrue silently (not visible/usable), rate 1.75/month.
--    Month 4: lump-sum credit of 3*1.75, then continues monthly.
--    If employee exits before completing month 4, forfeited entirely.
--    Call this on a scheduled monthly job, not at apply-time.
-- ---------------------------------------------------------------------
create or replace function fn_apply_probation_month_accrual(
    p_employee_id uuid,
    p_completed_month integer   -- 1,2,3,4... months since DOJ
) returns void as $$
declare
    v_fy_start_year integer;
    v_pl_id uuid;
    v_balance_id uuid;
    v_credit numeric;
begin
    select fy_start_year into v_fy_start_year
    from leave_balances lb
    join leave_types lt on lt.id = lb.leave_type_id
    where lb.employee_id = p_employee_id and lt.code = 'PL'
    order by fy_start_year desc limit 1;

    select id into v_pl_id from leave_types where code = 'PL';
    select id into v_balance_id from leave_balances
    where employee_id = p_employee_id and leave_type_id = v_pl_id
      and fy_start_year = v_fy_start_year;

    if p_completed_month < 4 then
        -- Accrues but stays invisible/unusable: tracked only via transaction
        -- log, NOT added to balance yet.
        insert into balance_transactions (leave_balance_id, delta, reason, note)
        values (v_balance_id, 0, 'hr_manual_adjustment',
                format('Probation month %s accrued (1.75) but withheld until month 4', p_completed_month));
        return;
    elsif p_completed_month = 4 then
        v_credit := 3 * 1.75;  -- lump sum for months 1-3
    else
        v_credit := 1.75;      -- normal monthly accrual from month 5 onward
    end if;

    update leave_balances set accrued = accrued + v_credit, updated_at = now()
    where id = v_balance_id;

    insert into balance_transactions (leave_balance_id, delta, reason, note)
    values (v_balance_id, v_credit, 'hr_manual_adjustment',
            format('Probation accrual released at month %s', p_completed_month));
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 3. PLANNED-LEAVE NOTICE VALIDATION
--    <=2 days notice needed: 14 days | <=7 days: 28 days | >7 days: 56 days
--    Returns the number of days that must be force-converted to LWP due
--    to insufficient notice (0 if compliant). Handbook example: 3-day
--    leave with 3 weeks' notice (needs 4) -> 1 day becomes LWP.
-- ---------------------------------------------------------------------
create or replace function fn_check_planned_leave_notice(
    p_applied_on date,
    p_start_date date,
    p_leave_length_days numeric
) returns numeric as $$
declare
    v_notice_given integer;
    v_notice_required integer;
    v_shortfall_days numeric;
begin
    v_notice_given := p_start_date - p_applied_on;

    if p_leave_length_days <= 2 then
        v_notice_required := 14;
    elsif p_leave_length_days <= 7 then
        v_notice_required := 28;
    else
        v_notice_required := 56;
    end if;

    if v_notice_given >= v_notice_required then
        return 0;
    end if;

    -- Proportional shortfall converted to LWP days, rounded up to whole days,
    -- capped at the total leave length. Matches the handbook's "1 day becomes
    -- LWP" example for a minor shortfall rather than voiding the whole leave.
    v_shortfall_days := ceil(
        (v_notice_required - v_notice_given)::numeric / v_notice_required * p_leave_length_days
    );
    return least(v_shortfall_days, p_leave_length_days);
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 4. ANNUAL RESET / CARRY-FORWARD / ENCASHMENT / LAPSE
--    Runs once per employee on 25 March, across SL+CL+PL combined unused.
--    First 7 unused -> carried forward (as PL next FY)
--    Next 7 unused   -> encashed
--    Remainder       -> lapsed
-- ---------------------------------------------------------------------
create or replace function fn_annual_leave_reset(p_employee_id uuid, p_old_fy_start_year integer)
returns void as $$
declare
    v_total_unused numeric;
    v_carry_forward numeric;
    v_encashed numeric;
    v_lapsed numeric;
    v_new_fy_start_year integer;
    v_pl_id uuid;
    v_new_pl_balance_id uuid;
    v_bal record;
begin
    select coalesce(sum(closing_balance), 0) into v_total_unused
    from leave_balances lb
    join leave_types lt on lt.id = lb.leave_type_id
    where lb.employee_id = p_employee_id
      and lb.fy_start_year = p_old_fy_start_year
      and lt.code in ('SL', 'CL', 'PL');

    v_carry_forward := least(v_total_unused, 7);
    v_encashed := least(greatest(v_total_unused - 7, 0), 7);
    v_lapsed := greatest(v_total_unused - 14, 0);

    v_new_fy_start_year := p_old_fy_start_year + 1;
    select id into v_pl_id from leave_types where code = 'PL';

    -- Ensure next FY balances exist (should already, via pro-ration/renewal job)
    select id into v_new_pl_balance_id from leave_balances
    where employee_id = p_employee_id and leave_type_id = v_pl_id
      and fy_start_year = v_new_fy_start_year;

    if v_new_pl_balance_id is not null and v_carry_forward > 0 then
        update leave_balances
        set opening_balance = opening_balance + v_carry_forward, updated_at = now()
        where id = v_new_pl_balance_id;

        insert into balance_transactions (leave_balance_id, delta, reason, note)
        values (v_new_pl_balance_id, v_carry_forward, 'carry_forward',
                format('Carried forward from FY%s (max 7)', p_old_fy_start_year));
    end if;

    -- Log encashment/lapse against the OLD fy balances for audit purposes
    for v_bal in
        select lb.id from leave_balances lb
        join leave_types lt on lt.id = lb.leave_type_id
        where lb.employee_id = p_employee_id
          and lb.fy_start_year = p_old_fy_start_year
          and lt.code in ('SL', 'CL', 'PL')
        order by lt.code limit 1   -- log once, not per-type, since these figures are combined
    loop
        if v_encashed > 0 then
            insert into balance_transactions (leave_balance_id, delta, reason, note)
            values (v_bal.id, -v_encashed, 'encashment',
                    format('Encashed at FY%s close (combined SL+CL+PL unused)', p_old_fy_start_year));
        end if;
        if v_lapsed > 0 then
            insert into balance_transactions (leave_balance_id, delta, reason, note)
            values (v_bal.id, -v_lapsed, 'lapse',
                    format('Lapsed at FY%s close (combined SL+CL+PL unused)', p_old_fy_start_year));
        end if;
    end loop;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 5. COMP-OFF CREDIT
--    0.5 day credited to Planned Leave per full 9hr day worked on a
--    holiday/weekend, post supervisor approval. Called by app after
--    manager approves a comp-off request (comp-off itself is not a
--    leave_requests row — it's a direct balance credit).
-- ---------------------------------------------------------------------
create or replace function fn_credit_comp_off(
    p_employee_id uuid,
    p_fy_start_year integer,
    p_days_worked numeric,       -- e.g. 1.0 for full day, 0.5 for half day WFH on holiday
    p_approved_by uuid
) returns void as $$
declare
    v_pl_id uuid;
    v_balance_id uuid;
    v_credit numeric;
begin
    v_credit := p_days_worked * 0.5;
    select id into v_pl_id from leave_types where code = 'PL';
    select id into v_balance_id from leave_balances
    where employee_id = p_employee_id and leave_type_id = v_pl_id and fy_start_year = p_fy_start_year;

    update leave_balances set accrued = accrued + v_credit, updated_at = now()
    where id = v_balance_id;

    insert into balance_transactions (leave_balance_id, delta, reason, created_by, note)
    values (v_balance_id, v_credit, 'comp_off_credit', p_approved_by,
            format('Comp-off: %s day(s) worked on holiday/weekend', p_days_worked));
end;
$$ language plpgsql;


-- =====================================================================
-- WonderBiz Leave Management System — HR Manual Recording
-- Migration: 003_leave_recording_functions.sql
--
-- Sprint 1 of the leave-tracker completion plan: lets HR record a leave
-- directly (no approval chain) via POST /api/leave/requests. This adds
-- the balance-debit side of that flow, plus columns the API route needs
-- to persist write-through sync state to the main attendance dashboard
-- (a separate Supabase project — see lib/leaveSync.ts).
-- =====================================================================

alter table leave_requests
  add column if not exists sync_status text not null default 'pending'
      check (sync_status in ('pending', 'synced', 'failed')),
  add column if not exists sync_error text;

comment on column leave_requests.sync_status is
  'Write-through sync of this leave to the MAIN dashboard project''s leave_records table. Two separate Supabase projects, no distributed transaction, so this is tracked explicitly rather than assumed — see lib/leaveSync.ts and the retry-sync API route.';

-- ---------------------------------------------------------------------
-- 6. DEBIT LEAVE BALANCE ON APPROVAL (S1-1)
--    Called right after a leave_requests row is created with
--    status='approved' (currently only the hr_manual path — see
--    app/api/leave/requests/route.ts). Derives employee/type/FY from
--    the request row itself so the caller can't pass a mismatched
--    balance by mistake.
--
--    LWP (leave_types.is_directly_applicable = false) is not a real
--    entitlement — it's a running tally of unpaid days, so it's
--    allowed to go negative (uncapped, per the schema's design
--    invariants above). Every other type IS a real entitlement: this
--    function refuses to debit past zero for SL/CL/PL, since silently
--    over-drawing a capped balance is a data-integrity issue, not a
--    policy call HR should be able to wave through from the request
--    form. If HR needs to record more than the remaining balance, the
--    shortfall belongs in a separate LWP leave_requests row instead —
--    the API layer's policy checks (certificate/notice-period) are
--    advisory and non-blocking (S1-2), but this guard is not.
-- ---------------------------------------------------------------------
create or replace function fn_debit_leave_on_approval(p_leave_request_id uuid)
returns void as $$
declare
    v_req record;
    v_lt record;
    v_fy_start_year integer;
    v_balance_id uuid;
    v_current_closing numeric;
begin
    select * into v_req from leave_requests where id = p_leave_request_id;
    if not found then
        raise exception 'leave_requests row % not found', p_leave_request_id;
    end if;

    select * into v_lt from leave_types where id = v_req.leave_type_id;

    -- Same 25-Mar FY cutover as fn_prorate_new_joiner, keyed off the
    -- leave's start_date (the day actually being debited), not
    -- applied_on/now() — a leave straddling the boundary must debit
    -- the FY it falls in, not the FY it was recorded in.
    if extract(month from v_req.start_date) > 3
       or (extract(month from v_req.start_date) = 3 and extract(day from v_req.start_date) >= 25) then
        v_fy_start_year := extract(year from v_req.start_date)::integer;
    else
        v_fy_start_year := extract(year from v_req.start_date)::integer - 1;
    end if;

    select id, closing_balance into v_balance_id, v_current_closing
    from leave_balances
    where employee_id = v_req.employee_id
      and leave_type_id = v_req.leave_type_id
      and fy_start_year = v_fy_start_year;

    if v_balance_id is null then
        raise exception
            'No leave_balances row for employee %, type %, FY%s — run fn_prorate_new_joiner (or the annual renewal job) before recording leave',
            v_req.employee_id, v_lt.code, v_fy_start_year;
    end if;

    if v_lt.is_directly_applicable and (v_current_closing - v_req.total_days) < 0 then
        raise exception
            '% balance is insufficient for employee % in FY%s: have %, need % — route the shortfall through a separate LWP entry instead',
            v_lt.code, v_req.employee_id, v_fy_start_year, v_current_closing, v_req.total_days;
    end if;

    update leave_balances
    set used = used + v_req.total_days, updated_at = now()
    where id = v_balance_id;

    insert into balance_transactions (leave_balance_id, delta, reason, reference_id, note)
    values (v_balance_id, -v_req.total_days, 'leave_approved', p_leave_request_id,
            format('Debited %s day(s) for leave_requests %s (%s, %s to %s)',
                   v_req.total_days, p_leave_request_id, v_lt.code, v_req.start_date, v_req.end_date));
end;
$$ language plpgsql;


-- =====================================================================
-- WonderBiz Leave Management System — Live Read + Balance Seeding/Adjustment
-- Migration: 004_live_read_and_balance_admin.sql
--
-- Context: the main attendance dashboard used to get leave data via a
-- one-way write-through sync (lib/leaveSync.ts) into its own project's
-- leave_records table, which could fail with only a per-record retry
-- button as a signal. That's been replaced with a live read: the main
-- dashboard's server now queries THIS project directly (via its own
-- service-role key, from a route the main dashboard's own session auth
-- gates) at render time, so there is no copy to drift and nothing left
-- to sync. sync_status/sync_error on leave_requests are dead weight
-- now — dropping them rather than leaving a column nobody writes to
-- sit there implying a sync state that no longer exists.
-- =====================================================================

alter table leave_requests
  drop column if exists sync_status,
  drop column if exists sync_error;

-- 'opening_balance_seed' — the one-time Phase 1.3 seeding of existing
-- employees' opening balances is a distinct event from a new joiner's
-- pro-ration (fn_prorate_new_joiner uses 'pro_ration_initial'): there is
-- no DOJ-based math here, just "no historical data exists, so grant the
-- full annual quota." Keeping it as its own reason keeps the audit trail
-- honest about which of the two actually happened for a given employee.
alter table balance_transactions
  drop constraint if exists balance_transactions_reason_check,
  add constraint balance_transactions_reason_check check (reason in
      ('comp_off_credit', 'hr_manual_adjustment', 'carry_forward',
       'encashment', 'lapse', 'leave_approved', 'leave_cancelled',
       'lwp_conversion', 'pro_ration_initial', 'opening_balance_seed'));

-- ---------------------------------------------------------------------
-- 7. SEED OPENING BALANCES (S1-3)
--    One-time, idempotent: for every employee who does NOT already have
--    a leave_balances row for the given FY, grant the full annual quota
--    (5 SL / 5 CL / 11 PL, LWP untouched — it has no pool). There is no
--    historical leave data to prorate or backfill against, so this is a
--    flat grant, not fn_prorate_new_joiner's DOJ-based math — do not
--    reuse that function here, it would under-credit anyone who joined
--    before this FY started.
--    Safe to re-run: the `on conflict do nothing` plus the "already has
--    a row" filter mean employees seeded (or prorated) once are skipped.
-- ---------------------------------------------------------------------
create or replace function fn_seed_opening_balances_current_fy(p_fy_start_year integer)
returns table(employee_id uuid, seeded boolean) as $$
declare
    v_emp record;
    v_sl_id uuid; v_cl_id uuid; v_pl_id uuid; v_lwp_id uuid;
    v_balance_id uuid;
begin
    select id into v_sl_id from leave_types where code = 'SL';
    select id into v_cl_id from leave_types where code = 'CL';
    select id into v_pl_id from leave_types where code = 'PL';
    select id into v_lwp_id from leave_types where code = 'LWP';

    for v_emp in
        select e.id from employees e
        where not exists (
            select 1 from leave_balances lb
            where lb.employee_id = e.id and lb.fy_start_year = p_fy_start_year
        )
    loop
        insert into leave_balances (employee_id, leave_type_id, fy_start_year, opening_balance)
        values
            (v_emp.id, v_sl_id, p_fy_start_year, 5),
            (v_emp.id, v_cl_id, p_fy_start_year, 5),
            (v_emp.id, v_pl_id, p_fy_start_year, 11),
            (v_emp.id, v_lwp_id, p_fy_start_year, 0)
        on conflict (employee_id, leave_type_id, fy_start_year) do nothing;

        for v_balance_id in
            select id from leave_balances
            where employee_id = v_emp.id and fy_start_year = p_fy_start_year
        loop
            insert into balance_transactions (leave_balance_id, delta, reason, created_by, note)
            values (v_balance_id, 0, 'opening_balance_seed', null,
                    'opening balance — seeded, no historical data available');
        end loop;

        employee_id := v_emp.id;
        seeded := true;
        return next;
    end loop;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- 8. HR MANUAL BALANCE ADJUSTMENT (S1-4)
--    The audited path behind the "adjust balance" UI on the employee's
--    page. Always goes through manual_adjustment (never opening_balance,
--    accrued, or used directly) and always produces a balance_transactions
--    row — mirrors how fn_debit_leave_on_approval never touches
--    closing_balance directly either. p_delta may be negative (a
--    correction going the other way) — LWP is excluded since it has no
--    pool to adjust (its balance is a derived running tally, not a
--    quota HR grants).
-- ---------------------------------------------------------------------
create or replace function fn_adjust_balance_manual(
    p_employee_id uuid,
    p_leave_type_code text,
    p_fy_start_year integer,
    p_delta numeric,
    p_reason text,
    p_created_by uuid
)
returns void as $$
declare
    v_lt record;
    v_balance_id uuid;
begin
    if p_reason is null or length(trim(p_reason)) = 0 then
        raise exception 'A reason is required for a manual balance adjustment';
    end if;

    select id, code from leave_types into v_lt where code = p_leave_type_code;
    if not found then
        raise exception 'Unknown leave type code %', p_leave_type_code;
    end if;
    if v_lt.code = 'LWP' then
        raise exception 'LWP has no balance pool to adjust — it is a derived running tally, not a quota';
    end if;

    select id into v_balance_id from leave_balances
    where employee_id = p_employee_id and leave_type_id = v_lt.id and fy_start_year = p_fy_start_year;

    if v_balance_id is null then
        raise exception
            'No leave_balances row for employee %, type %, FY%s — seed or prorate this employee first',
            p_employee_id, v_lt.code, p_fy_start_year;
    end if;

    update leave_balances
    set manual_adjustment = manual_adjustment + p_delta, updated_at = now()
    where id = v_balance_id;

    insert into balance_transactions (leave_balance_id, delta, reason, created_by, note)
    values (v_balance_id, p_delta, 'hr_manual_adjustment', p_created_by, p_reason);
end;
$$ language plpgsql;

-- =====================================================================
-- Row Level Security — mirrors the pattern in the main dashboard's
-- supabase/schema.sql: any authenticated user in THIS project has full
-- read/write. Safe for v1 because this project's only users are HR
-- super admins created manually in the Supabase dashboard (no self
-- signup). When employee/tech-lead/manager self-service logins are
-- added later, these policies need to be tightened to check role and
-- ownership (e.g. an employee can only see their own leave_requests) —
-- do not carry this "authenticated = full access" model forward blindly.
-- =====================================================================

alter table employees enable row level security;
alter table leave_types enable row level security;
alter table leave_balances enable row level security;
alter table balance_transactions enable row level security;
alter table statutory_leave_records enable row level security;
alter table leave_requests enable row level security;
alter table approval_steps enable row level security;

create policy "authenticated read/write" on employees
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on leave_types
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on leave_balances
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on balance_transactions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on statutory_leave_records
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on leave_requests
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write" on approval_steps
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- =====================================================================
-- WonderBiz Leave Management System — Bulk Workforce Events
-- Migration: 005_workforce_events.sql
--
-- WFH, Business Travel, and Office Shutdown are workforce/attendance
-- signals, not leave — per the schema's own design invariant ("WFH is
-- NOT a leave type... never touches leave_balances"), so this table is
-- deliberately independent of leave_requests/leave_balances: no FK into
-- either, no policy-engine function touches it, and the bulk-insert API
-- route built against it (D6-3) never calls fn_debit_leave_on_approval
-- or writes to leave_balances. That's what the Day 6 acceptance
-- criterion "bulk events do not touch leave_balances" is checking.
-- =====================================================================

create table if not exists workforce_events (
    id                  uuid primary key default gen_random_uuid(),
    employee_id         uuid not null references employees(id),
    event_type          text not null check (event_type in
                            ('wfh', 'business_travel', 'office_shutdown')),
    event_date          date not null,
    note                text,
    created_by          uuid references employees(id),
    created_at          timestamptz not null default now(),
    unique (employee_id, event_date, event_type)
);

comment on table workforce_events is
    'WFH / Business Travel / Office Shutdown markers only. Not a leave type — intentionally has no relationship to leave_balances or leave_requests.';

create index if not exists idx_workforce_events_employee_date
    on workforce_events(employee_id, event_date);

alter table workforce_events enable row level security;
create policy "authenticated read/write" on workforce_events
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');