-- 0011: two independent additions requested together —
--
-- 1) HR-initiated password reset needs somewhere to record "this
--    employee is on a temp password HR set for them and must change it
--    on next login" so the app can force that flow. employment_status /
--    notice_period_days (probation + notice period) already existed
--    since the original schema (see supabase-leave/schema.sql) and are
--    already enforced by the policy engine — this migration does NOT
--    touch those, only adds what's new.
--
-- 2) Bulk workforce events (WFH / Business Travel / Office Shutdown)
--    had a hard check-constraint limiting event_type to exactly those
--    three values. HR wants to record other kinds of events (e.g.
--    "Client Visit", "Training", "Team Offsite") without a code change
--    each time, so the constraint is relaxed to "any short, non-empty
--    label" instead of a fixed enum. The three original values remain
--    the default/suggested options in the UI — this only widens what
--    the column will accept.

alter table employees
    add column if not exists must_change_password boolean not null default false;

comment on column employees.must_change_password is
    'Set true when HR resets this employee''s password to a temporary one. Cleared automatically the next time the employee successfully changes their own password.';

-- Widen workforce_events.event_type from a fixed 3-value enum to any
-- short non-empty label (still constrained so it can't be blank or
-- absurdly long — this is a display label, not free-form text).
alter table workforce_events drop constraint if exists workforce_events_event_type_check;
alter table workforce_events
    add constraint workforce_events_event_type_check
    check (char_length(trim(event_type)) between 1 and 40);
