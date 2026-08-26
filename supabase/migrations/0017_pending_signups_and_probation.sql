-- 0017_pending_signups_and_probation.sql
--
-- Two additions on top of 0016_google_oauth_and_directory.sql, for the
-- simplified onboarding flow: new hire signs in with Google FIRST, HR
-- acknowledges and completes their record SECOND (reversed from the
-- original "HR creates the record first" flow — both still work; see
-- app/api/auth/callback/route.ts and app/leave/pending/page.tsx for how
-- this branches).
--
-- ── pending_employee_signups ────────────────────────────────────────
-- A holding row for "someone with a valid @wonderbiz.in Google account
-- signed in, but no employees record exists for them yet." NOT a
-- second employees table and NOT a "full employee master record" (the
-- original spec's wording) — it only ever holds what Google already
-- verified (name, email, photo, Google id) plus the auth_user_id that
-- already exists in Supabase Auth from the sign-in itself. None of the
-- HR-owned fields (employee_code, role, department, DOJ, reporting
-- lines) exist on this table at all — those only get set once, at the
-- moment HR turns this into a real employees row (see
-- app/api/leave/employees/route.ts's pending_signup_id handling).
--
-- Deleted (not archived) once HR acknowledges it and the real employees
-- row is created — see the same route. If HR never acts, it just sits
-- here and the person keeps seeing the "stay tuned" holding page
-- (app/leave/pending/page.tsx) on every visit; signing in again with
-- Google just refreshes name/photo on the same row (upsert on
-- auth_user_id), never creates a second one.
create table if not exists pending_employee_signups (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique,
  email         text not null,
  full_name     text,
  avatar_url    text,
  google_id     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists idx_pending_signups_email
  on pending_employee_signups (lower(email));

-- RLS enabled with NO policies attached — every legitimate access path
-- (app/api/auth/callback, app/api/leave/admin/pending-signups,
-- app/api/leave/employees POST) goes through the service-role client,
-- which bypasses RLS entirely, same as every other privileged write in
-- this project. This is a brand-new table with zero existing callers to
-- break, so unlike the broader RLS question flagged in
-- lib/leaveSupabase/getCurrentEmployee.ts's header comment, there's no
-- risk here in defaulting to "no direct client access at all" rather
-- than the wide-open "authenticated" policy every other table uses.
alter table pending_employee_signups enable row level security;

-- One narrow exception to "no client access at all": a signed-in person
-- needs to be able to check whether THEY are the one waiting on HR (see
-- lib/leaveSupabase/getCurrentEmployee.ts's getPendingSignupRedirect and
-- app/leave/pending/page.tsx) — self-read only, nothing else. Every
-- write, and every read of anyone else's row (the HR Ack queue), still
-- goes through the service-role client only.
create policy "self can view own pending signup" on pending_employee_signups
  for select
  using (auth.uid() = auth_user_id);

comment on table pending_employee_signups is
  'Holding row for a Google sign-in with no matching employees record yet, awaiting HR acknowledgment. Never a substitute for the employees table — see app/leave/pending/page.tsx.';

-- ── employees.probation_months ──────────────────────────────────────
-- Optional per-employee override of the existing company-wide
-- leave_policy_config.probation_unlock_months (see
-- 0012_config_regularisation_wfh_thresholds.sql and lib/leavePolicy.ts).
-- The probation-leave-auto-LWP-conversion rule itself is NOT new — it
-- already runs off date_of_joining + probation_unlock_months. This
-- column only lets HR set a different length for one specific person at
-- Ack time (e.g. an experienced hire with a shorter probation) without
-- changing the number for the whole company. NULL (the default, and
-- what every existing employee has right now) means "use the company
-- default" — see how getAutoLwpConversionReason's unlockMonths argument
-- is resolved at both call sites in
-- lib/leaveSupabase/applyLeavePolicyAndMutateBalance.ts.
alter table employees
  add column if not exists probation_months integer;

comment on column employees.probation_months is
  'Per-employee override, in months, of leave_policy_config.probation_unlock_months. NULL = use the company-wide default. Set by HR at Ack time (app/leave/admin/employees/AddEmployeeForm.tsx).';
