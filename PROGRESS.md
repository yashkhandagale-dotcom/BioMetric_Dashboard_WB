# BioMetric Dashboard — Fix-It Progress Log

---

## Sprint 1: Discovery & Root-Cause Confirmation

**Scope (from Sprint Plan tab, Sprint 1 row):** confirm — don't assume — what's
actually true in the live/production environment before anything gets changed.
No code was modified this sprint; this is a read-only investigation.

### What I could confirm directly from the checked-in code (high confidence)

**1. `employees` / `custom_departments` are NOT defined anywhere in the
dashboard's checked-in schema.**
- `supabase/schema.sql` (the dashboard project's schema) has zero `create table`
  statements for `employees` or `custom_departments`. Its only tables are
  `uploaded_months`, `attendance_records`, `column_mappings`, `leave_records`,
  `custom_holidays`, `dashboard_settings`, `shared_links`.
- The *only* `create table employees` in the whole repo lives in
  `supabase-leave/schema.sql` — a completely different table, in a
  completely different Supabase project, with a different column set
  (`full_name`, `email`, `role`, `office`, etc. — not the same shape the
  dashboard code expects).
- Yet `supabase/schema.sql` ends with a migration block that opens with
  *"Run this once against your existing `employees` table"* and does
  `alter table employees add constraint employees_code_office_unique unique
  (employee_code, office_code);` — i.e., whoever wrote that migration assumed
  an `employees` table already existed in the dashboard project, without ever
  having checked in the `create table` for it. That's a strong signal the
  table was created by hand in the Supabase Table Editor (or via a migration
  that was applied live and never committed) rather than never existing at
  all — but the code alone can't prove which.
- Meanwhile `lib/employeeStore.ts` actively queries and writes to
  `employees` and `custom_departments` on the **dashboard's** Supabase client
  (`loadEmployeeDirectory()`, `setEmployeeDepartment()`, `deleteEmployee()`,
  `addDepartment()`, etc.) — so if these tables genuinely don't exist in
  prod, every one of those calls has been failing silently, which lines up
  exactly with Issue #1's symptom (department overrides / deletions don't
  persist).

**2. Which Supabase project each `.env` var set points to — confirmed
correctly separated in code, not yet confirmed in the actual deployed
`.env`.**
- `lib/supabase/client.ts` / `server.ts` (dashboard) read only
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY`.
- `lib/leaveSupabase/client.ts` / `server.ts` (Leave Tracker) read only
  `NEXT_PUBLIC_LEAVE_SUPABASE_URL` / `NEXT_PUBLIC_LEAVE_SUPABASE_ANON_KEY` /
  `LEAVE_SUPABASE_SERVICE_ROLE_KEY` — distinct variable names, no shared
  client, comments in both files explicitly say "deliberately separate,
  don't merge."
- No cross-wiring bug in the code itself. No real `.env` is checked in
  (correctly git-ignored) so this couldn't be verified against the actual
  deployed environment from the repo alone.

**3. Department mismatch pattern — traced end-to-end in code (root cause
confirmed).**
- **Dashboard side:** a row's displayed department = CSV-uploaded
  `attendance_records.department`, unless `lib/employeeStore.ts`'s in-memory
  `directory` has an override for that `(employee_code, office_code)` pulled
  from the dashboard project's `employees` table.
- **Leave Tracker side:** `app/leave/admin/employees/page.tsx` reads
  department straight from the Leave Tracker's *own* `employees.department`
  column in the completely separate `supabase-leave` project.
- No sync mechanism anywhere in the code between the two. Any HR
  reassignment made in one system structurally cannot reach the other.
- Flagged for Sprint 3 (not fixed, out of scope for Sprint 1/2): the Leave
  Tracker's `employees.employee_code` is globally `unique not null`, while
  the dashboard treats codes as unique only per-office. If Leave Tracker
  becomes the master store, that constraint needs to change first.

### Decisions made this sprint
- None — Sprint 1 is verification-only. No code or schema files were changed.

### Open questions left for Sprint 2
1. Do `employees` / `custom_departments` actually exist in the live
   dashboard Supabase project?
2. Do `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_LEAVE_SUPABASE_URL` in the
   real deployed `.env` point at two genuinely different projects?
3. A real reproduced example of a department mismatch (nice-to-have, not
   blocking — root cause already confirmed at the code level).

**Sprint 1: DONE**

---

## Sprint 2: Critical Fix — Employee Directory Persistence

**Scope (from Sprint Plan tab, Sprint 2 row):** make department overrides /
employee deletions in the Dashboard actually persist, with visible errors on
failure instead of silent no-ops.

### Note on Sprint 1's open question #1 (did I get an answer?)

No — this session's inputs didn't include an answer to "do `employees` /
`custom_departments` exist in prod?" (the re-uploaded project ZIP was the
original untouched one, not a copy with a live-checked answer attached).

Rather than block Sprint 2 on that missing answer, **the migration below was
written to be correct either way**, using `create table if not exists`:
- If the tables genuinely don't exist in prod, this creates them fresh with
  the exact shape `lib/employeeStore.ts` needs.
- If they already exist (created by hand, matching Sprint 1's suspicion),
  `if not exists` makes this a safe no-op on the table itself — but **it
  cannot add or fix columns on a pre-existing table**, so I documented right
  in the SQL comment exactly which columns/shape the code expects, so
  whoever runs this can reconcile by hand if needed.
- The pre-existing `employees_code_office_unique` constraint migration
  (already in the file from before Sprint 1) was also made idempotent (wrapped
  in a `do $$ ... $$` block checking `pg_constraint` first) rather than a bare
  `alter table ... add constraint`, since it's now very plausible this runs
  right after this same script just created the table fresh — a bare
  `add constraint` a second time would error.

**This is a genuine, still-open risk if the tables already exist in prod
with a very different shape than expected** (e.g. missing the `department`
or `is_deleted` columns entirely) — in that case this migration won't error,
but the app will still fail against the wrong column set. **You still need
to check the Supabase Table Editor once** to confirm, or just run the
migration and watch whether the new toast error-handling (below) reports
anything when you test reassigning a department. I did not treat this as a
scope change worth pausing for, since the fix works correctly either way —
flagging it here per the "ask before proceeding if it changes scope"
instruction, but proceeding since I don't think it does change scope, just
resolves the fork Sprint 1 identified.

### What changed

**1. `supabase/schema.sql`**
- Added `create table if not exists employees (...)` and
  `create table if not exists custom_departments (...)` with the exact shape
  `lib/employeeStore.ts` writes to (`employee_code`, `office_code`,
  `employee_name`, `department`, `is_deleted`, `deleted_at`, `updated_at` for
  `employees`; `name` for `custom_departments`).
- Enabled RLS + added the same `"authenticated read/write"` policy on both
  new tables, matching every other table in this file. **This closes a second
  possible cause of the exact same symptom**: every other table in this
  schema has RLS enabled with an explicit policy; if `employees` /
  `custom_departments` were ever created by hand via the Table Editor with
  Supabase's RLS-on-by-default and no policy attached, every query against
  them — even from a signed-in HR user — would be silently blocked by RLS,
  which looks identical to "the table doesn't exist." This is now covered
  for a freshly-created table either way.
- Wrapped the existing `employees_code_office_unique` constraint migration in
  an idempotent `do $$ ... $$` block (see above).

**2. `lib/employeeStore.ts`**
- Every function that talks to Supabase (`loadEmployeeDirectory`,
  `setEmployeeDepartment`, `clearEmployeeDepartmentOverride`,
  `deleteEmployee`, `restoreEmployee`, `addDepartment`) now returns a result
  object (`{ success: boolean; error?: string }`, or
  `{ success, duplicate?, error? }` for `addDepartment`) instead of `void`.
- **The in-memory `directory` cache is no longer updated optimistically
  before the write succeeds.** Every write function now: (1) calls Supabase,
  (2) checks `error`, (3) only updates local state + calls `notify()` if the
  write actually succeeded. On failure, the local cache is left untouched
  and the error message is returned to the caller — so a failed write no
  longer *looks* like it worked until the next reload, per the sprint's exit
  criteria.
- `loadEmployeeDirectory()` similarly leaves the last-known-good directory in
  place (rather than quietly reverting to an "everyone has no overrides"
  state) if the initial load fails, and reports the error back.

**3. `components/EmployeePanel.tsx`**
- Added an optional `onToast` prop.
- `changeDepartment`, `handleDelete`, `handleRestore` now check the result of
  the store call and call `onToast('error', ...)` on failure, and stop (no
  panel-close, no local re-render) rather than proceeding as if it worked.

**4. `components/SettingsPanel.tsx`**
- Added an optional `onToast` prop.
- `handleAddDepartment` now distinguishes the existing inline "duplicate
  name" validation (unchanged — still shows next to the input) from a
  genuine write failure (now toasted).
- The "Restore" button in the Deleted Employees list now checks the result
  and toasts on failure.

**5. `app/page.tsx`**
- Wired the existing `showToast` function into the HR `EmployeePanel`
  instance and into `SettingsPanel` via the new `onToast` prop. (The
  read-only Manager-view `EmployeePanel` instance was left alone — it never
  calls any write path.)
- The `loadEmployeeDirectory()` effect on mount now toasts an error if the
  initial load fails, instead of silently proceeding.

### Verification done this session
- `npx tsc --noEmit` — clean, no type errors.
- `npx next build` (with dummy Supabase env vars, since no live credentials
  are available in this sandbox) — **build succeeds**, all routes compile,
  including every route touched this sprint.
- **Not done (needs a real Supabase project + credentials, which this
  sandbox doesn't have):** the sprint's manual verification step — actually
  reassigning a department, reloading in a new session, and confirming it
  stuck. This has to happen against your live project.

### Decisions made this sprint (with reasoning)
- **Wrote the schema migration to be safe under both "table exists" and
  "table doesn't exist" scenarios** instead of waiting for Sprint 1's open
  question to be answered, using `create table if not exists` plus an
  idempotent constraint block. Reasoning: this satisfies the exit criteria
  either way and doesn't block progress on a manual check that may take a
  while to get back to me; the risk (existing table with an incompatible
  shape) is now called out explicitly in the SQL comments and in this log
  rather than silently assumed away.
- **Added RLS + policy for the two new tables** even though the sprint task
  only mentioned the migration and error handling, because leaving new
  tables without RLS/policy while every sibling table has both would be
  inconsistent with the file's own convention *and* a second, independent way
  to reproduce Issue #1's exact symptom (silently-blocked queries look
  identical to a missing table). This is the smallest change that makes the
  new tables consistent with the rest of the file — not a broader RLS audit
  of the schema.
- **Did not touch `app/leave/**` or anything in `supabase-leave/schema.sql`**
  — out of scope for this sprint (Sprint 3's job).

### Files touched this sprint
- `supabase/schema.sql` — added `employees` / `custom_departments` tables,
  RLS + policies for both, idempotent constraint migration.
- `lib/employeeStore.ts` — every read/write function now returns a result
  object; local state only updates after a confirmed successful write.
- `components/EmployeePanel.tsx` — `onToast` prop; error surfacing on
  department change / delete / restore.
- `components/SettingsPanel.tsx` — `onToast` prop; error surfacing on add
  department (write failures only, not the duplicate-name case) and restore.
- `app/page.tsx` — wired `showToast` into both components above; toasts a
  failed initial directory load.
- `PROGRESS.md` — this update (plus Sprint 1's content, since the ZIP
  re-uploaded for this session was the original one without it — re-added
  from the Sprint 1 log you pasted in).

### Open questions for Sprint 3
1. **Still open from Sprint 1:** confirm in the Supabase Table Editor whether
   `employees` / `custom_departments` existed before this sprint's migration,
   and if so, whether their column shape matches what's now documented in
   `supabase/schema.sql`'s comments. If it doesn't match, those columns need
   to be reconciled by hand (this migration won't do it for you on an
   existing table).
2. **Still open from Sprint 1:** confirm `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_LEAVE_SUPABASE_URL` in the real deployed `.env` are two
   different projects.
3. **New from this sprint:** please run the manual verification step
   yourself once this is deployed — reassign a department (or delete an
   employee), reload in a new session/browser, confirm it stuck. If it
   *doesn't* stick and a toast now shows an error, that error message will
   tell us directly whether it's a missing-table, RLS, or column-mismatch
   problem, which will save Sprint 3 from re-diagnosing.
4. Sprint 3 (Single Source of Truth) still needs a decision on the Leave
   Tracker's globally-unique `employee_code` constraint (flagged in Sprint 1)
   before it can make Leave Tracker the master store, if that's the chosen
   direction.

**Sprint 2: DONE** — migration, error handling, and toast wiring complete and
type-checked/build-verified in this sandbox. The one thing that still needs
you: deploy this and run the actual reload-and-confirm test against your live
Supabase project (I have no credentials or network access to do that from
here), and let me know what the Table Editor shows for `employees` if you
haven't already, so Sprint 3 doesn't have to re-ask.

---

## Post-Sprint-2 pivot: single-DB architecture (user-directed, out of the
## original 8-sprint plan)

**This section documents a real scope change made mid-session at the user's
explicit direction** — not something decided unilaterally. After Sprint 2
closed, the user pasted the actual live schema dumps of both Supabase
projects (Dashboard + Leave Tracker) and asked to skip the plan's Sprint 3
approach (Leave Tracker as master + Dashboard does read-only cross-project
lookups) in favor of physically merging both into one new Supabase project.

**What the live dumps revealed (superseding some Sprint 1/2 assumptions):**
- `employees` / `custom_departments` **already existed in the live Dashboard
  project**, with the exact column shape `lib/employeeStore.ts` expected,
  **and already had the composite primary key** `(employee_code,
  office_code)` — better shape than Sprint 1 assumed. The "missing table"
  theory was wrong; Sprint 2's `create table if not exists` migration was a
  harmless no-op against prod.
- The Leave Tracker's real `employees` table confirmed: uuid PK,
  `employee_code text UNIQUE` (globally, not per-office), `auth_user_id`
  linking to Supabase Auth, role/reporting-hierarchy columns, plus 6 other
  tables (`leave_types`, `leave_balances`, `balance_transactions`,
  `statutory_leave_records`, `leave_requests`, `approval_steps`,
  `workforce_events`, `staging_existing_employees`) all FK-ing into it.
- **Confirmed with the user directly:** employee codes are globally unique
  in real data (no office ever reuses another office's code) — this
  resolved the one real design fork (composite key vs. single key) in favor
  of the simpler single `employee_code` key.

**Decisions made:**
1. **`employees` = Leave Tracker's model**, extended with `is_deleted` /
   `deleted_at` (new columns) for the Dashboard's "hide from charts" need —
   kept deliberately separate from `employment_status`, since exit status
   and dashboard-visibility are different concepts and conflating them
   would corrupt leave-balance logic tied to `employment_status`
   transitions.
2. **Column naming:** kept Leave Tracker's `office` (not Dashboard's
   `office_code`) since Leave Tracker has far more code/SQL depending on
   its exact shape. Dashboard's smaller data layer (`employeeStore.ts`)
   adapted instead of renaming Leave Tracker's column.
3. **Semantic change, flagged explicitly:** the old model was "CSV
   department, unless HR overrode it." The unified model has no such
   distinction — `employees.department` (NOT NULL in the new schema) is
   simply *the* department, and always wins over a CSV's value when the
   employee_code is known. `clearEmployeeDepartmentOverride` /
   `getEmployeeDepartmentOverride` were removed entirely (nothing left to
   "clear" or distinguish from an override) — `EmployeePanel.tsx` was
   updated to match: selecting the current department is now just a no-op,
   not a "revert to CSV" action.
4. **Writes are UPDATEs now, not upserts.** The unified `employees` table
   requires `role` (a specific enum) and `office`, which the Dashboard has
   no way to supply. So the Dashboard can only update an *existing* Leave
   Tracker-onboarded employee's `department` / `is_deleted` — it can no
   longer implicitly create a row. If a `setEmployeeDepartment` /
   `deleteEmployee` / `restoreEmployee` call matches zero rows, that's
   surfaced as an explicit toast error telling HR to onboard the person in
   the Leave Tracker first, rather than silently doing nothing or crashing.
5. **Auth is flagged, not silently merged.** One Supabase project means one
   `auth.users` table, so Dashboard and Leave Tracker logins now share an
   auth pool. Kept the two apps' **sessions** independent via distinct
   cookie names (`sb-dashboard-auth` / `sb-leave-auth`) so logging into one
   doesn't log you into the other. **Still open:** `middleware.ts` only
   checks "is there a session" for Dashboard access, not role — if a
   regular employee's Leave Tracker session cookie were ever presented to
   the Dashboard's check, today it's blocked only because the cookie names
   differ, not because of a role check. If that separation is ever relaxed,
   add a role check (`employees.role` via `auth_user_id`) to
   `middleware.ts` first. Not implemented now — a real access-control
   decision, not something to guess at.

**Files touched this pivot:**
- `unified_schema.sql` (new, at project root) — the full unified schema for
  a **brand-new, empty** Supabase project. Fixed one real bug during setup:
  `leave_balances.closing_balance` was written as a plain `default (...)`
  referencing sibling columns, which Postgres rejects — corrected to
  `generated always as (...) stored`.
- `.env.example` — collapsed from two URL/key sets to one.
- `lib/supabase/client.ts`, `lib/supabase/server.ts` — added explicit
  `cookieOptions: { name: 'sb-dashboard-auth' }`.
- `lib/leaveSupabase/client.ts`, `lib/leaveSupabase/server.ts` — repointed
  at the same `NEXT_PUBLIC_SUPABASE_URL`/keys as the dashboard, with
  `cookieOptions: { name: 'sb-leave-auth' }`.
- `lib/employeeStore.ts` — full rewrite: queries `employees` directly,
  keyed by `employee_code` alone, UPDATE instead of upsert, department is
  authoritative (not an override).
- `components/EmployeePanel.tsx` — removed calls to the two deleted
  override-specific functions; `changeDepartment` simplified accordingly.

**Verified this pivot:** `npx tsc --noEmit` clean, `npx next build` succeeds
end-to-end (dummy env vars, no live credentials available in this sandbox).

**NOT done — explicitly still open, needs you before this can go live:**
1. **Data migration.** This is schema only. Real employees, attendance
   history, leave balances/requests in both live projects still need to be
   migrated into the new project — not written yet, on purpose, since it's
   higher-risk than the schema and deserves its own careful pass rather
   than being rushed alongside everything else.
2. **Run `unified_schema.sql` against a real new Supabase project** and
   confirm it applies cleanly end-to-end (confirmed structurally sound and
   fully idempotent here, but never executed against a real Postgres
   instance from this sandbox — no live DB access).
3. **The role-based-access question in point 5 above** — needs an explicit
   decision, not a guess.
4. Once 1–3 are resolved: update the real `.env` and redeploy.

This pivot supersedes what Sprint 3 in the original plan would have done
(Leave Tracker as master + read-only cross-project lookup) — Sprint 3's
row in the sprint plan can be treated as done differently than originally
scoped, not skipped.

---

## Post-pivot fix: CSV upload now auto-onboards employees into the Leave Tracker

**Reported symptom:** biometric dashboard shows all employees after a CSV
upload; Leave Tracker shows none, no matter how many times leave policy
was configured. Confirmed this wasn't a policy problem — `employees` had
zero rows, and nothing in the app ever wrote to it except manual
onboarding via the Leave Tracker's own "Add Employee" form. CSV upload
only ever wrote to `attendance_records`. This is exactly the gap flagged
(but not built) in the pivot section above as "Sprint 4's planned CSV
auto-creation."

**What changed:**
- `lib/employeeStore.ts` — new `ensureEmployeesFromAttendance(records)`.
  For each employee_code in a saved CSV batch, `INSERT ... ON CONFLICT
  (employee_code) DO NOTHING` into `employees`, with `role: 'employee'`
  as a safe default (satisfies the not-null check constraint) and
  `department`/`office`/`full_name` taken from the CSV row.
  **Deliberately DO NOTHING, not DO UPDATE**, on conflict: an
  already-onboarded employee's role, email, reporting lines, and any
  HR-set department must never be silently overwritten by the next
  biometric upload. This preserves the existing invariant in
  `applyEmployeeDirectory()` that `employees.department` is the single
  source of truth over CSV data, not the other way around.
- `lib/storage.ts` — `saveRecords()` now calls
  `ensureEmployeesFromAttendance()` right after attendance rows are
  upserted, and returns `{ added, updated, employeesCreated,
  employeesSyncError }` instead of just `{ added, updated }`. Employee
  sync failing does not throw / block the attendance save — losing
  attendance data over a directory-sync error would be worse than
  reporting the sync error and moving on.
- `app/page.tsx` — the per-file upload result string now appends
  `"— N new employees onboarded to Leave Tracker"` when applicable, or a
  visible warning if the employee sync itself failed, instead of staying
  silent either way.

**What this does NOT do (by design, flagged explicitly):**
- Does not set `email` (CSVs don't have it) — stays `null`, fine per
  schema.
- Does not set `reporting_tech_lead_id` / `reporting_manager_id` /
  `date_of_joining` — HR still needs to fill these in via the Leave
  Tracker for anything that depends on the reporting hierarchy (approval
  routing) or accurate pro-ration.
- Does not retroactively backfill leave balances for newly-created
  employees — that still requires running "Seed Balances"
  (`/api/leave/admin/seed-balances`) after upload, same as before. Could
  be chained automatically in a future pass if wanted, but kept as a
  separate explicit action here since it's a leave-granting operation and
  shouldn't happen silently as a side effect of a CSV upload.
- Does not change `department` for an employee who already exists — see
  above.

**Verification done:** `npx tsc --noEmit` clean; `npx next build`
succeeds end-to-end (dummy env vars, no live Supabase credentials
available in this sandbox).

**Still needs you (no live DB access from here):**
1. Deploy this and upload a real CSV against your actual Supabase
   project; confirm new `employee_code`s appear in `leave/admin/employees`
   immediately after upload.
2. Run "Seed Balances" afterward to grant them their leave policy quota
   for the current FY.
3. If you want new-hire fields (reporting lines, date of joining, role
   other than the 'employee' default) filled in automatically instead of
   manually per person, that needs a decision on where that data would
   come from — CSVs don't carry it today.

---

## /leave/admin redesign (user-directed)

**User's requests, verbatim intent:**
1. Show the full employee list (what `/leave/admin/employees` had) directly
   on `/leave/admin`.
2. Add a "Leave Analytics" button at top.
3. Remove "Manage Employees" — CSV creates employees now, so a separate
   add/manage page has no job left to do. Adjust button should absorb
   status/manager/lead management per employee instead.
4. Remove "Record Leave" and "Seed Balances" buttons entirely — leave
   balance seeding will run as a DB script, not a UI action.
5. "Back to balances" should go directly to `/leave/admin`, not through
   an intermediate page.

**What changed:**
- **`app/leave/admin/page.tsx`** — full rewrite. Now fetches and renders
  the same rich `EmployeeGrid` the old `/leave/admin/employees` page used
  (search/filter by dept/office/status, per-card Adjust/Record
  Leave/View Profile), instead of the old plain balances table. Top nav
  is now: Leave Analytics · Leave History · Violations · Bulk Events.
  "Record Leave" and "Manage Employees" removed — the former was, on
  inspection, a bug: both linked to the exact same URL
  (`/leave/admin/employees`) under different labels. "Seed Balances" is
  gone from the UI entirely per the user's direction (runs as a DB
  script now, outside the app).
- **`app/leave/admin/analytics/page.tsx`** (new) — `LeaveAnalytics`,
  previously always rendered inline at the bottom of `/leave/admin`
  (running its queries on every load whether anyone looked at it or
  not), moved to its own route behind the new top button.
- **`app/leave/admin/employees/page.tsx`** — content moved into
  `/leave/admin` (above); this route now just `redirect()`s there,
  rather than being deleted outright, in case anything has it
  bookmarked/linked.
- **`app/leave/admin/employees/AddEmployeeForm.tsx`** — deleted. Its job
  (create the initial employee row) is now done automatically by
  `ensureEmployeesFromAttendance` on CSV upload; anything a CSV can't
  supply (status, role, reporting tech lead/manager) moved into the
  Adjust button's new Details tab (below) instead of a separate form.
- **`app/leave/admin/SeedBalancesButton.tsx`** — deleted (unused after
  removal from `page.tsx`; the seed-balances API route itself
  (`/api/leave/admin/seed-balances`) is untouched in case the DB script
  the user mentioned ends up calling it directly rather than being pure
  SQL).
- **`app/leave/admin/AdjustBalanceButton.tsx`** — grew a second tab.
  "Balance" is the original adjust-SL/CL/PL-with-a-reason flow,
  unchanged. New "Details" tab edits `employment_status`, `role`,
  `reporting_tech_lead_id`, `reporting_manager_id` — the exact fields
  the old Add Employee form captured that CSV upload can't supply.
  Deliberately does NOT touch `department`/`office`/`full_name`/`email`
  — those are either CSV-owned (department/office/name, per
  `applyEmployeeDirectory`'s existing single-source-of-truth rule) or
  out of scope for this pass (email).
- **`app/api/leave/employees/[id]/profile/route.ts`** — added a `PATCH`
  handler backing the Details tab above. Validates `role` and
  `employment_status` against their DB check-constraint value sets
  before writing, and rejects an employee being set as their own tech
  lead/manager (the same self-reference footgun the FK columns would
  otherwise silently allow).
- **`components/leave/EmployeeCard.tsx`** /
  **`components/leave/EmployeeGrid.tsx`** — `EmployeeWithBalances` type
  gained `reportingTechLeadId` / `reportingManagerId` so the Adjust
  button's Details tab can prefill correctly; empty-state copy on the
  grid updated (no longer says "add one above", since there's no add
  form above anymore).
- **`app/leave/admin/history/page.tsx`**,
  **`app/leave/admin/violations/page.tsx`**,
  **`app/leave/admin/bulk-events/page.tsx`** — "← Back to employees"
  links repointed from `/leave/admin/employees` (the now-redirected
  intermediate page) straight to `/leave/admin` as "← Back to balances".
  This was the literal cause of the "back button jumps from here and
  there" complaint — it wasn't a broken link, just a two-hop one.

**What this does NOT do (flagged, not decided here):**
- Per-employee-card "Record Leave" button (opens `RecordLeaveDrawer`)
  was kept — this is a working, distinct feature (marking an actual
  leave taken) from the removed top-nav button, which was a mislabeled
  duplicate link. If this should also go, say so explicitly — did not
  want to guess on this one.
- The Details tab does not (yet) surface each person's *current* tech
  lead/manager *name* next to the dropdown, only the ID via
  pre-selection — fine for now since the dropdown shows the right
  option selected, but a "currently reports to: X" label would be a
  small nice-to-have if wanted.
- Email and date-of-joining are still not editable anywhere in the UI
  post-CSV-onboarding (never were, outside the deleted Add Employee
  form). Flagging in case that turns out to matter for approval routing
  or pro-ration later.

**Verification done:** `npx tsc --noEmit` clean; `npx next build`
succeeds end-to-end (26 routes compile, including the new
`/leave/admin/analytics`), dummy env vars, no live Supabase credentials
available in this sandbox.

**Still needs you:** deploy and click through for real — especially the
Details tab's save (needs a live `employees` table with at least two
people to meaningfully test the tech lead/manager dropdowns), and the DB
script for balance seeding, since that's intentionally outside this
app now.