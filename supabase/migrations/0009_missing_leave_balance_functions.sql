-- Migration: 0009_missing_leave_balance_functions.sql
-- Run this in the SQL Editor of your live (unified) Supabase project.
--
-- WHY THIS IS NEEDED:
-- unified_schema.sql (the schema actually run against your current
-- Supabase project) only creates TABLES — it does not include any of the
-- 8 plpgsql functions (fn_prorate_new_joiner, fn_debit_leave_on_approval,
-- fn_annual_leave_reset, etc.) that supabase-leave/schema.sql defines.
-- Those functions got dropped during the merge from two separate Supabase
-- projects (Dashboard + Leave Tracker) into one unified project, and
-- sql was never updated to carry them over.

-- The app calls these via `service.rpc('fn_debit_leave_on_approval', ...)`
-- (see app/api/leave/employees/requests/route.ts) and equivalents for the
-- other 5 functions the app calls (fn_prorate_new_joiner,
-- fn_apply_probation_month_accrual, fn_check_planned_leave_notice,
-- fn_annual_leave_reset, fn_seed_opening_balances_current_fy). Since none
-- of them exist in the live database, PostgREST returns:
--   "Could not find the function public.fn_debit_leave_on_approval
--   (p_leave_request_id) in the schema cache"
-- for every one of them, not just the leave-recording path — approving a
-- new joiner's proration, the annual reset job, and the notice-period
-- check will all hit the same error once triggered.
--
-- This migration is a straight copy of the function bodies from
-- supabase-leave/schema.sql. All the tables they reference (leave_types,
-- leave_balances, balance_transactions, leave_requests, employees) already
-- exist in unified_schema.sql under the same names/columns, so nothing
-- else needs to change — this is purely additive.
--
-- AFTER RUNNING THIS: Supabase/PostgREST caches the function list and
-- doesn't always pick up new functions instantly. If you still see the
-- "not found in schema cache" error right after running this, either:
--   (a) wait ~30-60 seconds and retry, or
--   (b) run `NOTIFY pgrst, 'reload schema';` in the SQL Editor, or
--   (c) Supabase Dashboard → Settings → API → "Reload schema cache" button.
-- ═══════════════════════════════════════════════════════════════════════════

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
