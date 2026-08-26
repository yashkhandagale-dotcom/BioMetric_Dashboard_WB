-- 0016_google_oauth_and_directory.sql
--
-- Adds what's needed for Google OAuth login + Google Workspace directory
-- sync on top of the EXISTING employees table (see unified_schema.sql /
-- supabase-leave/schema.sql, and lib/leaveSupabase/getCurrentEmployee.ts
-- for how `role`, `auth_user_id`, and `must_change_password` already
-- work). Nothing here duplicates that — it only adds the handful of
-- columns those flows don't already have:
--
--   - google_id              : Google's stable subject id for the linked
--                               account (NOT the email — email can
--                               technically change on Google's side,
--                               google_id never does). Used to detect a
--                               "this auth_user_id is linked to a
--                               DIFFERENT Google identity than expected"
--                               conflict; not used for lookup (lookup is
--                               always by email, see app/api/auth/callback).
--   - auth_provider           : 'password' | 'google' — which flow this
--                               person's login actually goes through.
--                               Purely informational (Admin panel column,
--                               and lets the callback tell "first Google
--                               login for an existing password account"
--                               apart from "brand new Google-only account").
--   - avatar_url              : Google profile photo. Directory-owned,
--                               never HR-owned, never employee-editable.
--   - job_title               : Google Workspace job title. Directory-owned.
--                               Kept deliberately separate from `department`
--                               (already HR-owned, unchanged) and from any
--                               notion of `role` (WonderBiz's own
--                               permission level — Google never sets this,
--                               see app/api/auth/callback/route.ts).
--   - phone                   : Directory-sourced, but employee-editable
--                               afterward (see app/leave/onboarding) —
--                               the one field on this list that isn't
--                               exclusively Google/HR owned.
--   - profile_confirmed_at    : NULL until the employee has been through
--                               the first-login onboarding screen once
--                               (see app/leave/onboarding/page.tsx) and
--                               confirmed/edited the fields they're
--                               allowed to touch. Deliberately independent
--                               of must_change_password — a Google-only
--                               account never sets a WonderBiz password at
--                               all, so that flag alone can't gate
--                               onboarding for them.
--   - directory_synced_at     : last time this row's directory-owned
--                               fields (avatar_url, job_title, phone as a
--                               suggested default, full_name/email) were
--                               refreshed from Google Workspace via
--                               lib/googleWorkspace.ts. NULL if this
--                               employee was never touched by a directory
--                               sync (e.g. created manually by HR).
--   - last_login_at           : updated on every successful sign-in,
--                               password or Google (see app/login/page.tsx
--                               and app/api/auth/callback/route.ts).
--                               Surfaced in the Admin panel per the
--                               "Last login if available" requirement.
--
-- `is_deleted` is a pre-existing column (unified_schema.sql). Removing it
-- from `where` clauses elsewhere is out of scope for this migration and
-- untouched.

alter table employees
  add column if not exists google_id text,
  add column if not exists auth_provider text not null default 'password'
    check (auth_provider = any (array['password'::text, 'google'::text])),
  add column if not exists avatar_url text,
  add column if not exists job_title text,
  add column if not exists phone text,
  add column if not exists profile_confirmed_at timestamptz,
  add column if not exists directory_synced_at timestamptz,
  add column if not exists last_login_at timestamptz;

-- google_id should uniquely identify at most one employee once set, same
-- invariant as auth_user_id already has. Partial index (not a plain
-- unique constraint) so the many existing rows with google_id = null
-- don't collide with each other.
create unique index if not exists idx_employees_google_id
  on employees (google_id)
  where google_id is not null;

comment on column employees.google_id is
  'Google account subject id linked at first Google sign-in. Lookup for login is always by email (see app/api/auth/callback) — this is only used to detect a mismatched re-link.';
comment on column employees.auth_provider is
  'How this employee actually authenticates: password (HR-issued / self-changed) or google (Google Workspace SSO). Informational — does not itself grant access.';
comment on column employees.profile_confirmed_at is
  'Set once, the first time this employee completes the post-login onboarding confirmation screen (app/leave/onboarding). NULL = show onboarding next login. Independent of must_change_password.';
comment on column employees.directory_synced_at is
  'Last time avatar_url/job_title/phone-suggestion/full_name/email were refreshed from Google Workspace Directory (lib/googleWorkspace.ts). NULL = never synced (e.g. HR-created row).';
comment on column employees.last_login_at is
  'Updated on every successful sign-in (password or Google). Shown as "Last login" in the Admin panel.';
