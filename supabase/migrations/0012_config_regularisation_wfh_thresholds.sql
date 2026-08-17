-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0012 — Feedback batch (Shreya / Nitin Sakpal / Shakti, Aug 2026):
--
--   1. KPI cards: who's on pre-approved leave today          (no schema change —
--      served by a new read helper over existing leave_requests)
--   2. Leave Regularisation                                   -> leave_regularisations
--   3. Leave Configuration & Policy (config-driven, not hardcoded)
--                                                              -> leave_policy_config
--                                                                 + fn_check_planned_leave_notice rewritten
--                                                                   to read leave_types.min_notice_days_tier
--                                                                   instead of hardcoded 14/28/56
--   4. Leave thresholds & alerts                               -> leave_type_thresholds,
--                                                                  leave_threshold_alerts
--   5/6. WFH application + Delivery Manager approval           -> wfh_requests
--        (routes through the SAME department_managers / getEffectiveApproverId
--        mechanism leave already uses — "Delivery Manager" is just the manager
--        assigned to the Delivery department, per the confirmed answer; no new
--        role was needed)
--   7. Reapply after rejection                                 -- app-layer only, no schema change
--  10. Approve/reject confirmation popup                       -- UI only, no schema change
--  11. Pending leave reminders                                 -- served by existing
--                                                                  notifications table + a new
--                                                                  scheduled job, no schema change
--  12. Cancellation/withdrawal                                 -- already existed (0009-era work)
--  13. Manager leave visibility tab                            -- app-layer only, no schema change
--
-- Explicitly OUT of scope for this migration (see conversation with HR/PM):
--   - OAuth authentication (#9) — deferred, not implemented.
--   - Direct biometric/attendance software integration (#8) — needs vendor
--     details (API vs. export vs. DB access) not available yet; not implemented.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------
-- 3. LEAVE POLICY CONFIG — the two global numeric knobs that were
-- hardcoded in lib/leavePolicy.ts (probation unlock month, default
-- notice-period length). Per-leave-type knobs (annual_quota,
-- max_consecutive_days, min_notice_days_tier, requires_certificate_
-- after_days) already lived on `leave_types` since the original schema
-- — those were already configurable, just with no HR-facing UI to edit
-- them yet (added in this batch, see app/leave/admin/config).
-- Singleton row (id is always 1) rather than a generic key/value table:
-- there are only ever two values, an HR UI needs to read/write both
-- atomically, and a fixed-shape row is far harder to typo into a
-- broken app state than a bag of untyped key/value strings.
-- ---------------------------------------------------------------------
create table if not exists leave_policy_config (
    id                          smallint primary key default 1 check (id = 1),
    probation_unlock_months    integer not null default 4,
    notice_period_default_days integer not null default 30,
    updated_by                  uuid references employees(id) on delete set null,
    updated_at                  timestamptz not null default now()
);

insert into leave_policy_config (id) values (1) on conflict (id) do nothing;

alter table leave_policy_config enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'leave_policy_config' and policyname = 'authenticated read/write'
  ) then
    create policy "authenticated read/write" on leave_policy_config
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- Rewrite fn_check_planned_leave_notice to read the notice tiers out of
-- leave_types.min_notice_days_tier (already existed as a jsonb column,
-- already seeded, just never actually read by this function — the SQL
-- body had 14/28/56 hardcoded instead). Expected shape going forward:
--   [{"max_days": 2, "notice_days": 14}, {"max_days": 7, "notice_days": 28}, {"max_days": null, "notice_days": 56}]
-- ordered ascending by max_days, with max_days: null meaning "everything
-- longer than the previous tier". Falls back to the original 14/28/56
-- behavior if a row's tier data is missing/malformed, so this migration
-- can never leave the policy engine in a broken state for PL specifically.
create or replace function fn_check_planned_leave_notice(
    p_applied_on date,
    p_start_date date,
    p_leave_length_days numeric
) returns numeric as $$
declare
    v_notice_given integer;
    v_notice_required integer;
    v_shortfall_days numeric;
    v_tiers jsonb;
    v_tier jsonb;
begin
    v_notice_given := p_start_date - p_applied_on;

    select min_notice_days_tier into v_tiers
    from leave_types where code = 'PL';

    v_notice_required := null;
    if v_tiers is not null and jsonb_typeof(v_tiers) = 'array' then
        for v_tier in
            select value from jsonb_array_elements(v_tiers)
            order by (value->>'max_days')::numeric asc nulls last
        loop
            if (v_tier->>'max_days') is null or p_leave_length_days <= (v_tier->>'max_days')::numeric then
                v_notice_required := (v_tier->>'notice_days')::integer;
                exit;
            end if;
        end loop;
    end if;

    -- Fallback to the original hardcoded tiers if config is missing/bad.
    if v_notice_required is null then
        if p_leave_length_days <= 2 then
            v_notice_required := 14;
        elsif p_leave_length_days <= 7 then
            v_notice_required := 28;
        else
            v_notice_required := 56;
        end if;
    end if;

    if v_notice_given >= v_notice_required then
        return 0;
    end if;

    v_shortfall_days := ceil(
        (v_notice_required - v_notice_given)::numeric / v_notice_required * p_leave_length_days
    );
    return least(v_shortfall_days, p_leave_length_days);
end;
$$ language plpgsql;

-- Seed the tiered jsonb shape onto the existing PL row (idempotent — only
-- touches the tier column, only when it's still the old shape or null),
-- so the new function has real data to read instead of falling back.
update leave_types
set min_notice_days_tier = '[{"max_days": 2, "notice_days": 14}, {"max_days": 7, "notice_days": 28}, {"max_days": null, "notice_days": 56}]'::jsonb
where code = 'PL'
  and (min_notice_days_tier is null or not (min_notice_days_tier ? '0'));
-- (the "? '0'" guard is just "does this look like the old
-- {"<=2":14,...} object shape rather than an array" — cheap enough to
-- not bother being cleverer about detecting already-migrated rows.)

-- ---------------------------------------------------------------------
-- 4. LEAVE THRESHOLDS & ALERTS — HR configures, per leave type, "notify
-- me + the relevant manager(s) if this many requests of this type land
-- within a rolling week". `leave_type_thresholds` is the config;
-- `leave_threshold_alerts` is a dedupe/audit log so the weekly check job
-- (wired via the existing admin/jobs runner) never fires the same alert
-- twice for the same (leave_type, week).
-- ---------------------------------------------------------------------
create table if not exists leave_type_thresholds (
    id                    uuid primary key default gen_random_uuid(),
    leave_type_id         uuid not null unique references leave_types(id) on delete cascade,
    weekly_count_threshold integer not null default 5,
    alert_enabled         boolean not null default false,
    updated_by             uuid references employees(id) on delete set null,
    updated_at             timestamptz not null default now()
);

alter table leave_type_thresholds enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'leave_type_thresholds' and policyname = 'authenticated read/write'
  ) then
    create policy "authenticated read/write" on leave_type_thresholds
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- One default (disabled) row per existing leave type so the config page
-- always has something to render/edit rather than an empty table.
insert into leave_type_thresholds (leave_type_id, weekly_count_threshold, alert_enabled)
select id, 5, false from leave_types
on conflict (leave_type_id) do nothing;

create table if not exists leave_threshold_alerts (
    id                uuid primary key default gen_random_uuid(),
    leave_type_id     uuid not null references leave_types(id) on delete cascade,
    week_start        date not null,   -- Monday of the ISO week this alert covers
    request_count     integer not null,
    threshold_at_fire integer not null,
    department_counts jsonb,           -- {"Engineering": 3, "Sales": 2} — which departments/managers to notify
    created_at        timestamptz not null default now(),
    constraint leave_threshold_alerts_unique unique (leave_type_id, week_start)
);

alter table leave_threshold_alerts enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'leave_threshold_alerts' and policyname = 'authenticated read/write'
  ) then
    create policy "authenticated read/write" on leave_threshold_alerts
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. LEAVE REGULARISATION — manager-initiated note against an
-- employee's specific day (e.g. "left early for a client meeting").
-- Deliberately independent of leave_requests/leave_balances (like
-- workforce_events) — a regularisation is an attendance annotation, not
-- a leave grant: it doesn't debit any balance and doesn't need approval
-- of its own (the manager doing it IS the approval).
-- ---------------------------------------------------------------------
create table if not exists leave_regularisations (
    id            uuid primary key default gen_random_uuid(),
    employee_id   uuid not null references employees(id) on delete cascade,
    regularised_date date not null,
    reason        text not null,
    regularised_by uuid not null references employees(id) on delete set null,
    created_at    timestamptz not null default now(),
    constraint leave_regularisations_unique_per_day unique (employee_id, regularised_date)
);

create index if not exists idx_leave_regularisations_employee on leave_regularisations(employee_id);
create index if not exists idx_leave_regularisations_date on leave_regularisations(regularised_date);

alter table leave_regularisations enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'leave_regularisations' and policyname = 'authenticated read/write'
  ) then
    create policy "authenticated read/write" on leave_regularisations
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5/6. WFH REQUESTS — a real submit -> approve/reject workflow, unlike
-- workforce_events (which stays exactly what it is: a marker table with
-- no workflow, still used for HR bulk-entry and as the write target once
-- a WFH request is approved — see the approval service). Mirrors
-- leave_requests' shape/status vocabulary where it makes sense so the
-- UI patterns (ApprovalCard-style review, cancel, reapply) can be reused
-- almost verbatim, but has NO leave_balances relationship at all — WFH
-- is explicitly not leave (schema.sql's own design invariant #3).
-- Approval routing reuses the exact same department_managers /
-- getEffectiveApproverId mechanism leave uses — for a Delivery-
-- department employee that IS the Delivery Manager/Head, per the
-- confirmed product answer ("manager of delivery team is only delivery
-- head"). No new role was introduced for this.
-- ---------------------------------------------------------------------
create table if not exists wfh_requests (
    id                 uuid primary key default gen_random_uuid(),
    employee_id        uuid not null references employees(id) on delete cascade,
    start_date         date not null,
    end_date           date not null,
    is_half_day        boolean not null default false,
    half_day_session   text check (half_day_session in ('AM', 'PM')),
    reason             text not null,
    status             text not null default 'pending'
                            check (status in ('pending', 'approved', 'rejected', 'cancelled')),
    approver_id        uuid references employees(id) on delete set null,
    rejection_comment  text,
    applied_on         date not null default current_date,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create index if not exists idx_wfh_requests_employee on wfh_requests(employee_id);
create index if not exists idx_wfh_requests_status on wfh_requests(status);

alter table wfh_requests enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'wfh_requests' and policyname = 'authenticated read/write'
  ) then
    create policy "authenticated read/write" on wfh_requests
      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- Widen notifications.type to also accept the WFH event types added in
-- lib/leaveSupabase/notifyLeaveEvent.ts (item #5/#6) and drop the FK
-- into leave_requests (a WFH notification's "reference id" points at
-- wfh_requests, a different table — the column is kept, just no longer
-- FK-constrained to one specific table, same pattern already used for
-- attendance_exceptions.leave_request_id in migration 0007).
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
    check (type in
        ('leave_submitted', 'leave_approved', 'leave_rejected', 'leave_cancelled', 'leave_reminder',
         'wfh_submitted', 'wfh_approved', 'wfh_rejected', 'wfh_cancelled'));

alter table notifications drop constraint if exists notifications_leave_request_id_fkey;
comment on column notifications.leave_request_id is
    'References leave_requests.id for leave_* types, wfh_requests.id for wfh_* types. No FK constraint (see migration 0012) since it now points at two different tables depending on type.';

-- ---------------------------------------------------------------------
-- 7. Reapply-after-rejection needs to know what a rejected request's
-- original type/dates were so the "apply again as a different type" flow
-- can prefill the form — that's already fully present on leave_requests
-- and wfh_requests (status='rejected' rows are never deleted), so no
-- schema addition is needed here; it's a UI-only affordance.
-- ---------------------------------------------------------------------
