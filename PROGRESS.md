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

## Leave Policy Violation Rules + Login Fix (leave-policy-violation-rules
## prompt, worked alongside the calendar-view prompt)

### Login bug — root cause and fix
`lib/leaveSupabase/client.ts` and `lib/leaveSupabase/server.ts` had
drifted from the single-DB pivot above: they were still reading
`NEXT_PUBLIC_LEAVE_SUPABASE_URL` / `NEXT_PUBLIC_LEAVE_SUPABASE_ANON_KEY` /
`LEAVE_SUPABASE_SERVICE_ROLE_KEY`, none of which appear in `.env.example`
or anywhere else in the repo — those names belonged to the pre-pivot
split-project setup and were never removed when the pivot landed. Every
Leave Tracker auth call (sign-in, `getUser`, the `employees` lookup) was
therefore hitting an undefined Supabase project URL/key, while the
Dashboard's own login kept working because `lib/supabase/*` already read
the correct unified vars. Fixed by pointing both files at
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY`, same as the Dashboard's client files. The
distinct `sb-leave-auth` cookie name was correct already and is
untouched. Not verified against the actual deployed DB (the SQL export
mentioned as attached to the prompt wasn't actually provided) — worth a
quick check that `employees.auth_user_id` values in the real project
still resolve correctly, but the code-level cause is unambiguous and
isolated (grepped the whole repo; those var names appear nowhere else).

### 2a/2b/2c/3a — new/changed policy checks
Per section 5's confirmed design questions: check logic lives in a new
shared module, **`lib/leavePolicy.ts`** (not inlined into the route),
since the future employee self-apply / manager-approval routes (still
unbuilt) will need the same functions. The half-day check extends the
existing `ViolationType` union rather than getting its own endpoint.

- **2a (new) — combining-leaves adjacency.** `checkCombiningLeaves()` in
  `lib/leavePolicy.ts`: flags (advisory `policy_notes` entry, never
  blocks/converts) when a new request is adjacent — zero working days of
  gap, computed via the existing `getPredefinedHolidays()` — to an
  existing pending/approved request of a *different* leave type for the
  same employee. Wired into `app/api/leave/employees/requests/route.ts`,
  checked against the originally-requested leave type code.
- **2b (behavior change) — probation-period leave, any type, auto-LWP.**
  `getProbationLwpReason()` / `getAutoLwpConversionReason()` in
  `lib/leavePolicy.ts`. No longer PL-only and no longer advisory-only:
  any leave type starting before `date_of_joining + 4 months` is
  retyped to LWP at recording time (before the balance-debit step),
  `is_lwp_override = true`, `lwp_override_reason = 'Leave during
  probation period (before month-4 unlock)'`. Submission is never
  blocked. The old `early_probation_pl` case in
  `GET /api/leave/violations` is commented as legacy-only — historical
  rows still render, but new rows land under `lwp_conversion` instead.
- **2c (new) — notice-period leave auto-LWP.**
  `getNoticePeriodLwpReason()` in `lib/leavePolicy.ts`: triggers when
  `employment_status = 'notice_period'` and `start_date` falls on/after
  `date_of_exit - notice_period_days` (or, with no `date_of_exit` set
  yet, any date from today onward). Same auto-LWP mechanism as 2b,
  `lwp_override_reason = 'Leave during notice period'`. No schema
  changes, no last-working-day extension logic, per the finalized
  decision.
- **3a (follow-on) — half-day minimum-hours cross-check.** New
  `half_day_shortfall` entry added to the existing `ViolationType` union
  in `app/api/leave/violations/route.ts` (not a new endpoint), reusing
  `HALF_DAY_THRESHOLD_MINUTES` (now exported from
  `lib/attendanceExceptions.ts`) and `durationToMinutes` from
  `lib/parseCSV.ts` rather than reclassifying punch data independently.
  Cross-references approved half-day `leave_requests` rows against
  `attendance_records` by `employee_code` + date. Naturally post-hoc
  (attendance data usually lands after the leave is recorded), so it
  lives in the `GET` violations query, not the synchronous recording
  path.

### A gap the prompt didn't call out
`app/leave/admin/violations/page.tsx` keeps its own local `ViolationType`
union and `TYPE_LABELS` map for grouping/display, separate from the one
in `violations/route.ts`. Without updating it, `half_day_shortfall`
violations would compute correctly server-side but silently never render
in any group on the page (the grouping loop only iterates
`Object.keys(TYPE_LABELS)`). Added the label there too; also updated the
`lwp_conversion` / `early_probation_pl` labels to reflect 2b's behavior
change.

### Explicitly not touched (per section 4)
Maternity/paternity eligibility enforcement, employee self-apply /
manager-approval mutation routes, the calendar view, and any
notice-period-extension tracking — all out of scope here, as specified.

**Verified this sprint:** `npx tsc --noEmit` clean, `npx next build`
succeeds end-to-end (dummy env vars, no live credentials available in
this sandbox).

## Workstream 1 — Chart scaling fix (Master Plan, "what's next" run #1)

Context: `MASTER_PLAN.md` (new, at project root) is a consolidated plan
covering chart scaling, dark/light mode, and the leave-tracker redesign
(Sprints B–J, extending `LEAVE_TRACKER_OVERHAUL_PLAN.md`'s A–G). This entry
covers only Workstream 1, the first item actually implemented.

### Problem
`DailyTrendChart` and `ComparisonTrendChart` in `components/Charts.tsx`
rendered inside a fixed `<ResponsiveContainer width="100%" height={...}>`
with `interval="preserveStartEnd"` on the X-axis. Any number of data points
— 20 days or 200 — were squeezed into the same pixel width, so points
overlapped and only the first/last date label survived past roughly a
month of data. The attendance heatmap in the same file already solved this
correctly (`overflow-x-auto` + a `minWidth` that scales with date count) —
that pattern is now shared, not reinvented per chart.

### What changed
- **New file `lib/chartLayout.ts`** — `useTrendChartLayout()` hook +
  supporting functions (`pickGranularity`, `chartMinWidth`,
  `aggregateTrend`). Central place for "how should this trend chart size
  itself and does it need to aggregate" so future trend charts don't
  reintroduce the bug.
  - **≤ 45 days:** stays daily, chart grows horizontally
    (`overflow-x-auto` + `minWidth`) instead of squeezing.
  - **45–180 days:** auto-aggregates to weekly buckets (ISO week, averaged
    per numeric field).
  - **> 180 days (~6 months):** auto-aggregates to monthly buckets.
  - A `GranularityToggle` (Auto / Daily / Weekly / Monthly) lets the user
    override the automatic choice in either direction.
- **`components/Charts.tsx`:**
  - `DailyTrendChart` — now computes `{ data: chartData, granularity,
    minWidth, isAggregated }` via the hook (`averageKeys:
    ['attendanceRate']`, `sumKeys` for the count fields), wraps the chart
    in the scrollable/`minWidth` container, and adds the granularity
    toggle next to the existing info tooltip.
  - `ComparisonTrendChart` — same treatment; `averageKeys` is the dynamic
    per-department column list (`depts`) since those column names vary by
    selection. Renamed its internal raw-daily memo from `chartData` to
    `dailyRows` to avoid shadowing the new aggregated `chartData`.
  - **Click-to-drill-into-a-day behavior is now guarded by
    `isAggregated`.** A weekly/monthly point represents a range of days,
    not one day, so double-click-to-see-absentees and the `onDateClick`
    callback are intentionally no-ops in aggregated view — this is a
    deliberate UX decision, not a missed case. Switching the toggle back
    to Daily restores the previous click behavior exactly as it was.
  - Removed three leftover `console.log` calls in `handleChartClick`
    (`"CLICK"`, `"Invalid index"`, `"Opening modal"`) — debug logging that
    predated this change, cleaned up while already editing this function.
  - X-axis `interval` changed from `"preserveStartEnd"` to
    `"preserveStart"` on both charts — with the new scrolling/aggregation
    in place, letting Recharts drop only from one end (not skip the whole
    middle) reads better once there's room to scroll.

### Decisions made
- Auto-aggregation thresholds (45 days → weekly, 180 days → monthly) are a
  starting point, not backed by user testing — flagged as an open question
  in `MASTER_PLAN.md` in case you want them tuned.
- Aggregated points intentionally drop their `absentees` list (can't
  represent "who was absent" for a multi-day bucket meaningfully) — the
  tooltip and click-through are the features that change behavior in
  aggregated view, nothing else in the surrounding dashboard.
- Did **not** touch the other bar/heatmap charts in the same file
  (`DeptRankingChart`, `EmployeeDrillChart`, the heatmap, etc.) — those
  either already scale correctly (heatmap) or aren't affected by
  multi-month selection the same way (per-employee/per-department
  snapshots, not date-series). Only the two date-series line charts had
  the bug described.

### Unrelated pre-existing issue found and fixed
`npx next build` was failing **before this change too**, unrelated to
charts: `backup_before_leave_policy/` (a backup folder at the repo root,
not under `app/` or `components/`) has relative imports
(`./parseCSV`, `./useDashboardData`, `./predefinedHolidays`) that don't
resolve from that location. `tsconfig.json`'s `include` is `**/*.ts`, so
TypeScript picked it up and failed the build even though Next.js never
routes through it. Fixed by adding `"backup_before_leave_policy"` to
`tsconfig.json`'s `exclude`. This folder still exists on disk as a backup
(untouched) — only excluded from the TS build.

### Files touched this workstream
- `lib/chartLayout.ts` (new)
- `components/Charts.tsx` (edited — see above)
- `tsconfig.json` (edited — excluded the broken backup folder)
- `MASTER_PLAN.md` (new, at project root — the consolidated plan this
  entry implements the first piece of)

**Verified:** `npx tsc --noEmit` clean (aside from the now-excluded backup
folder), `npx next build` succeeds end-to-end with dummy env vars — 34
routes compiled, no errors.

**Not done yet — next up per `MASTER_PLAN.md`'s sequencing:**
1. Apply pending Supabase migrations (0007/0008/0009) to production —
   deployment step, not code, fixes the `department_managers` error from
   `Feature.txt`.
2. Dark/light mode foundation (Workstream 2).
3. Leave Tracker Sprint B (employee self-apply form) — see
   `LEAVE_TRACKER_OVERHAUL_PLAN.md` section 5a and `MASTER_PLAN.md`'s
   Sprint B/C/I sequencing notes for what it needs to reuse
   (`RecordLeaveForm`'s validation, the future
   `applyLeavePolicyAndMutateBalance()` service function).

---

## Workstream: Hours calculation consolidation + Actual/Effective hours everywhere

### Part 1 — Consolidate the duplicated "subtract 60min lunch" logic

**Problem:** the "if raw duration > 60min, effective = raw - 60, else
excluded" rule was independently re-implemented in three places —
`lib/useDashboardData.ts` (4 separate spots: `computeEmployeeKPIs`, the
`kpi` memo, the `employeeSummaries` accumulation loop, and its per-employee
average), `components/Charts.tsx`'s `HoursDistributionChart`, and
`lib/exportData.ts`'s Executive Summary calc — and had already drifted once
(see Part 2 below).

**Fix:** added `lib/hoursCalc.ts` with two exported functions:
- `effectiveMinutes(rawMinutes): number | null` — `rawMinutes - 60` if
  `rawMinutes > 60`, else `null` (day excluded from effective-hours
  averages, matching prior behavior everywhere).
- `actualMinutes(rawMinutes): number` — returns `rawMinutes` unchanged.

All duplicated inline copies of this rule in `lib/useDashboardData.ts`,
`components/Charts.tsx` (`HoursDistributionChart`), and
`lib/exportData.ts` (Executive Summary calc) now call
`effectiveMinutes()`/`actualMinutes()` instead of re-deriving the
subtraction. **Behavior of these three call sites is unchanged** — this
was pure consolidation, confirmed by `npx tsc --noEmit` (clean) and
`npx next build` (succeeds, 35 routes).

### Part 2 — Show both Actual and Effective hours, everywhere, clearly labeled

**Confirmed root cause of the mismatch:** `lib/exportData.ts`'s Department
Summary sheet computed "Avg Hours/Day" from raw duration with **no** lunch
subtraction, while the Executive Summary tab in the same export file
(`avgWorkingHours`) DID subtract it — same file, two tabs, ~1h apart for
the same period. Verified with a 5-record sample set
(`9:15, 8:50, 9:40, 8:05, 0:45`):

| Metric | Before fix | After fix |
|---|---|---|
| Department Summary "Avg Hours/Day" (old, unlabeled) | **7.32h** | *(column removed)* |
| Department Summary "Avg Actual Hours/Day" (new) | — | **7.32h** |
| Department Summary "Avg Effective Hours/Day" (new) | — | **7.96h** |
| Executive Summary "Avg Working Hours / Day" | 7.96h | 7.96h *(unchanged)* |

Department Summary's new "Avg Effective Hours/Day" (**7.96h**) now matches
Executive Summary's "Avg Working Hours / Day" (**7.96h**) exactly, for the
same sample period — previously 7.32h vs 7.96h, a 0.64h (~40min, growing to
~1h on real monthly data) disagreement. The new "Avg Actual Hours/Day"
(7.32h) is the honest raw-duration figure, now clearly labeled instead of
being silently presented as if it were the effective figure.

Note: the 5th sample record (`0:45`) has ≤60min raw duration, so it counts
toward Actual (n=5, any duration > 0) but is correctly excluded from
Effective (n=4) — this is why the two columns can have different sample
counts, by design (see `lib/hoursCalc.ts`'s `effectiveMinutes` doc comment).

**Files changed:**
- `lib/exportData.ts` — Department Summary sheet: replaced the single
  unlabeled/wrong "Avg Hours/Day" column with two columns, both from the
  shared helper: **"Avg Actual Hours/Day"** and **"Avg Effective
  Hours/Day"**, each with their own independent sample count (a day can
  count toward Actual without counting toward Effective).
- `components/EmployeePanel.tsx` — per-day table: the single "Hrs" column
  is now two columns, **"Actual"** and **"Effective"**, each with a header
  `InfoTooltip` (reusing `components/InfoTooltip.tsx`, already used
  elsewhere in the app) explaining the figure and, for Effective, the
  formula. Holiday-row `colSpan` bumped from 5 to 6 to account for the
  extra column. EmployeePanel's daily Effective-hours rows now use the
  exact same `effectiveMinutes()` helper as the employee's summary card
  average (`avgHoursWorked`, computed in `lib/useDashboardData.ts`'s
  `employeeSummaries`), so day-by-day figures mathematically average out
  to match the displayed summary — they were already both routed through
  the (now-shared) same formula, so this was consolidation, not a new fix.

**Other unlabeled single-hours-figure spots found, intentionally NOT
touched (out of this prompt's scope: `exportData.ts` + `EmployeePanel.tsx`
only) — flagging as follow-up prompts:**
- `components/KPICards.tsx` line ~132 — the single-day view's "Avg Working
  Hours" card is effective hours but doesn't say so in the label (the
  monthly view's equivalent card, ~10 lines down, is already correctly
  labeled "Avg Effective Hours").
- `lib/exportData.ts`'s **Employee Summary** sheet (Sheet 4, distinct from
  the Department Summary sheet touched above) — "Avg Hours/Day" column
  uses `emp.avgHoursWorked`, which is effective hours, unlabeled as such.
- `components/Charts.tsx`'s `HoursDistributionChart` drill-down list —
  each employee row shows `{avgHours}h avg`; the chart title/tooltip do
  say "effective" but the drill-down row itself doesn't repeat the word.

**Verify:** `npx tsc --noEmit` clean. `npx next build` succeeds (35 routes,
no errors). Re-exporting the same sample data before/after confirms
Executive Summary and Department Summary now report the same
actual-hours and same effective-hours figures for the same period (see
table above) — this was checked against real before/after numbers, not
just re-asserted from the code.

### Files touched this workstream
- `lib/hoursCalc.ts` (new — `effectiveMinutes()` / `actualMinutes()`)
- `lib/useDashboardData.ts` (edited — 4 call sites now use the shared
  helper; no behavior change)
- `components/Charts.tsx` (edited — `HoursDistributionChart` now uses the
  shared helper; no behavior change)
- `lib/exportData.ts` (edited — Executive Summary consolidated onto the
  shared helper (no behavior change); Department Summary sheet gained
  "Avg Actual Hours/Day" + "Avg Effective Hours/Day", replacing the old
  wrong single column)
- `components/EmployeePanel.tsx` (edited — per-day table's single "Hrs"
  column split into labeled "Actual" + "Effective" columns with
  `InfoTooltip`s; `colSpan` fix for the holiday row)

---

## Workstream: Consolidate the leave-balance write path

**Read fully before starting, per this prompt's instruction:**
`supabase-leave/schema.sql` (all 5 migrations) and `lib/leavePolicy.ts`.

### What's actually in the schema (not guessed)

- `leave_requests.source` has a DB-level check constraint allowing only
  `('employee_apply', 'hr_manual')` (schema.sql:154-155) — there is no
  migration anywhere in the file that widens it. The prompt's requested
  function signature uses a four-value vocabulary (`self_apply` /
  `manager_approval` / `hr_manual` / `cancellation`). These are **not**
  the same thing: the four-value vocabulary describes who/what is
  *calling* the function; the two-value column records how a request
  *originated*. `lib/leaveSupabase/applyLeavePolicyAndMutateBalance.ts`'s
  `dbSourceFor()` maps `self_apply` and `manager_approval` both onto
  `employee_apply` (an approval doesn't change how the request
  originated) and leaves `hr_manual` as-is; `cancellation` never writes
  the `source` column at all since it acts on an existing row. Flagging
  this explicitly rather than silently picking one of the four literal
  strings and having every write to `leave_requests.source` start
  failing its check constraint.
- `fn_debit_leave_on_approval` (schema.sql §6) is only ever invoked once
  a row is `status = 'approved'`. So `self_apply` requests are created as
  `'pending'` and are **not** debited at creation — only a later
  `manager_approval` call (once that route exists) flips them to
  `'approved'` and debits them. This matches the schema's own comment on
  that function ("currently only the hr_manual path").
- There is no SQL function that reverses a debit. `'leave_cancelled'` is
  a legal `balance_transactions.reason` (schema.sql:110) but nothing in
  `schema.sql` ever writes it. The `cancellation` branch does the
  credit-back directly against `leave_balances`/`balance_transactions`
  (same FY-boundary rule as `fn_debit_leave_on_approval`, reimplemented
  string-wise in `fyStartYearForDate()` rather than reusing
  `fyHelpers.ts`'s `getFYStartYear()` — that one takes a `Date` and reads
  it in local time, which is fine for "what FY is today" but risky for a
  fixed calendar date that must match the DB function's date-only math
  exactly).
- `lib/leavePolicy.ts` does **not** contain a "max-consecutive-days"
  check or an app-layer notice-period check as importable functions —
  those exist as `leave_types.max_consecutive_days` (a column, currently
  unused by any app code) and `fn_check_planned_leave_notice` (a SQL
  RPC, already called from the route via `service.rpc(...)`, not from
  `leavePolicy.ts`). `applyLeavePolicyAndMutateBalance.ts` calls the same
  RPC the same way the old route did, rather than inventing a TS
  reimplementation that doesn't exist in this codebase yet.

### 1. New `lib/leaveSupabase/applyLeavePolicyAndMutateBalance.ts`

The only function allowed to write to `leave_balances`,
`balance_transactions`, or `leave_requests` going forward. Internally:
runs `lib/leavePolicy.ts`'s `getAutoLwpConversionReason()` (probation +
notice-period auto-LWP) and `checkCombiningLeaves()`, plus the existing
`fn_check_planned_leave_notice` RPC for PL notice shortfall; creates or
updates the `leave_requests` row depending on `source`; writes the
`balance_transactions` row for approve (`fn_debit_leave_on_approval`, via
a new shared `debitWithLwpFallback()` helper) and cancel
(`leave_cancelled`, hand-written per the point above); calls
`notifyLeaveEvent()` at three points (submitted / approved / cancelled).

**`notifyLeaveEvent()` — Part 3 doesn't exist in this codebase yet**
(confirmed: `grep -rl notifyLeaveEvent` found nothing before this
change). Rather than skip the call site or invent what Part 3's real
implementation does, a same-shaped, local no-op stub lives at the bottom
of `applyLeavePolicyAndMutateBalance.ts` with a comment explaining it's
meant to be deleted and replaced with a real import once Part 3 lands —
every call site already passes the right event/requestId/employeeId/
source, so nothing else in the file should need to change then.

**Two additive, disclosed deviations from the prompt's literal
signature** (both documented at the top of the new file):
- Added `existingRequestId?: string` — `manager_approval` and
  `cancellation` act on an *existing* `leave_requests` row; there is no
  schema-legal way to approve or cancel a request without knowing which
  one, and the literal signature has no request id.
- `requestId` in the return type is `string | null`, not always
  `string` — on a genuine hard failure (e.g. neither the requested type
  nor LWP could be debited) the pre-existing route deletes the row it
  just inserted, so there is no id to return; `violation` carries the
  reason instead.

**Only `hr_manual` (via the route below) is wired to a real caller and
exercised by this prompt's required verification.** `self_apply`,
`manager_approval`, and `cancellation` are implemented directly against
what `schema.sql` documents (see above), but have no route calling them
yet — flagging that rather than claiming they're tested.

### 2. Migrated `app/api/leave/employees/requests/route.ts`

Every side effect that used to run inline in this route (policy checks,
the `leave_requests` insert, the debit-with-LWP-fallback, the synthetic
`approval_steps` row) now happens inside
`applyLeavePolicyAndMutateBalance({ ..., source: 'hr_manual' })`. The
route itself now only does request-shape validation (missing fields,
`leave_type_code` in the valid set, `half_day_session` required when
half-day) and reshapes the shared function's result back into the exact
JSON contract this route already had:
- Success: `{ leave_request, converted_to_lwp, policy_notes }`, 201 —
  `leave_request` is still the full persisted row (post any LWP
  conversion) with `leave_type_id` set to the *final* type, same as
  before.
- `debit_failed` violation: `{ error, policy_notes }`, 400 — the one
  case the old code returned `policy_notes` alongside an error.
- Every other violation: `{ error }`, 400.

One reordering, no behavior change: resolving `hrEmployeeId` (the
`employees` row for the signed-in `auth_user_id`, used for the
`approval_steps` audit row) now happens up front instead of at the very
end, since `applyLeavePolicyAndMutateBalance` needs it as an input
rather than something the route wires in after the fact. Same lookup,
same "skip the audit row if unresolved" fallback — only the position of
that one read moved.

`components/leave/RecordLeaveForm.tsx` needed **no changes**: it only
ever talks to this route's request/response contract (POST body shape
in, `SubmitResult` shape out), which this refactor left byte-identical.
Confirmed by reading the component fully — it does not call any
Supabase/server code directly, so there was no separate write path in it
to migrate.

### Verification

`npx tsc --noEmit` — clean. `npx next build` — succeeds, 35 routes, no
errors (same route count as before this change; `requests` route is
still present, now just delegating).

Structural before/after check (no live Supabase instance available in
this environment, so this checks the exact payloads each version would
send rather than a live round-trip) for a representative HR-manual entry
— PL, 2026-09-01 to 2026-09-03, no half-day:

| | Old inline route | New shared function (source: 'hr_manual') |
|---|---|---|
| `total_days` sent to insert | 3 | 3 |
| `end_date` sent to insert | 2026-09-03 | 2026-09-03 |
| `status` sent to insert | `approved` | `approved` |
| `source` sent to insert | `hr_manual` | `hr_manual` (via `dbSourceFor('hr_manual')`) |
| `half_day_session` sent | `null` | `null` |
| `action_plan` sent | *(key omitted — column defaults to null)* | `null` *(explicit — same stored value, RecordLeaveForm.tsx doesn't send this field)* |
| Debit call | `fn_debit_leave_on_approval(p_leave_request_id)` | `fn_debit_leave_on_approval(p_leave_request_id)` — identical RPC, identical arg |

`fn_debit_leave_on_approval`'s actual balance arithmetic lives entirely
inside the SQL function (schema.sql §6) — neither the old nor the new
code path touches or reimplements that math, so it cannot have changed;
both call sites invoke it identically. Manually recording a leave via
the live `RecordLeaveForm` UI against a real Supabase project (not
available in this sandboxed environment) is the remaining step to
confirm end-to-end, using the same PL/3-day scenario above and checking
`leave_balances.used`/`closing_balance` before and after match this
table's numbers.

### Files touched this workstream
- `lib/leaveSupabase/applyLeavePolicyAndMutateBalance.ts` (new — the only
  function now allowed to write `leave_balances` /
  `balance_transactions` / `leave_requests`)
- `app/api/leave/employees/requests/route.ts` (edited — delegates to the
  new function; request/response contract unchanged)
- `components/leave/RecordLeaveForm.tsx` — **not edited**; confirmed no
  changes needed (see above)

## Workstream: Leave Tracker self-service (Sprint B) + manager approvals
## (Sprint C), done together in one session per the combined prompt

Implements `/leave/me` (Part A) and `/leave/approvals` (Part B) fully.
Read every file the prompt named before writing anything —
`applyLeavePolicyAndMutateBalance()` already existed (see the workstream
above) and was reused as-is; `notifyLeaveEvent()` did not exist (it was
a documented no-op stub inside that file) and was built for real here.

### Part A — `/leave/me`

**A1 (KPI extraction).** `EmployeeModal.tsx`/`EmployeeTable.tsx` never
computed KPIs themselves — they render a precomputed `EmployeeSummary`
whose numbers already come from the one shared, pure, non-React
function every other KPI consumer imports:
`computeEmployeeKPIs()` in `lib/useDashboardData.ts`. Nothing about
attendance rate / late count / early-exit count / absent days /
productivity loss was reimplemented. What didn't exist yet was a
*server-side, single-employee, employee_id+date-range* caller — every
existing caller built `computeEmployeeKPIs`'s input client-side from an
already-uploaded in-memory CSV. New file
`lib/leaveSupabase/getEmployeeAttendanceKPIs.ts` is exactly that
plumbing: fetches `attendance_records` (paged via `selectAllRows`, the
same helper `lib/attendanceExceptions.ts` uses for wide-range queries)
+ approved `leave_requests` + `custom_holidays`/predefined holidays for
one employee over a window, shapes them into what `computeEmployeeKPIs`
expects, and calls it. Confirmed via `lib/leaveSupabase/server.ts` that
the Dashboard and Leave Tracker share one unified Supabase project, so
`attendance_records` is the literal same table — `/leave/me`'s numbers
are guaranteed to match the main dashboard for the same person/period,
there's no second copy to drift.

**A2 (Personal attendance report panel).** New
`components/leave/PersonalAttendanceReport.tsx` (client) + backing route
`app/api/leave/me/attendance/route.ts` (always resolves employee from
the session, never trusts a client-supplied id). Month selector reuses
`lib/leaveCalendar.ts`'s existing `currentMonthKey`/`monthLabel`/
`shiftMonthKey`/`monthBounds` — no new date-math helpers added. Hours
are shown as a labeled Actual/Effective pair (never a bare number) per
the convention in `lib/hoursCalc.ts`.

**A3 (Leave balance cards).** New `components/leave/LeaveBalanceCards.tsx`.
`getEmployeeBalances.ts`'s existing `getEmployeeBalancesByFY` only
exposes the *pivoted* `closing_balance` (remaining) — no
entitled/used split — so rather than have the component re-query
`leave_balances` itself (a second, independently-drifting read of a
table that file already owns), added one small **additive** export to
that same file, `getEmployeeBalanceBreakdown()`: same table, same
`fy_start_year`/`employee_id` scoping, just also selecting
`opening_balance`/`accrued`/`manual_adjustment`/`used` alongside
`closing_balance` instead of only the latter. No new balance math —
"entitled" is literally `opening_balance + accrued + manual_adjustment`,
the exact terms the DB's own generated `closing_balance` column already
sums.

**A4 (Leave history).** Reused `LeaveHistoryTable.tsx` as-is, scoped by
querying `leave_requests` with `employee_id = <me>` the same way
`app/api/leave/history/route.ts` already does (same columns, same
`recordedBy` derivation). One real fix inside the table itself: its
row type already had a `status` field, but the table never rendered a
Status column — added one (color-coded, same badge style as the rest of
the app) since A4 explicitly asks for
pending/approved/rejected/cancelled to be visible. Purely additive; the
admin History page (the table's other caller) is unaffected.

**A5 (Apply for Leave form).** New `components/leave/ApplyLeaveForm.tsx`
+ `ApplyLeaveDrawer.tsx` (matches `RecordLeaveDrawer.tsx`'s slide-over
pattern exactly — same mount/Escape/close behavior), posting to new
route `app/api/leave/me/requests/route.ts` with
`source: 'self_apply'`. Adds `action_plan`, required for Planned leave
per the schema's own comment on that column (`RecordLeaveForm.tsx`
never collects it, since it's the HR-side form). Policy violations are
never submit-blocking: the route always returns 201 with `policy_notes`
populated for a warning, exactly like the existing HR route already
does for `hr_manual`; only genuine hard failures (bad dates, missing
required fields, insert failure) return a 4xx. The client renders
`policy_notes` as a non-blocking amber banner ("This request violates
policy... It will still be sent for approval") and the request has
already been created by the time it's shown.

**A6.** `app/leave/me/page.tsx` rewritten as an async Server Component:
fetches employee + balance breakdown + full history in parallel, renders
attendance report (left/wide) + balance cards (top-right) + history
(full-width, bottom). The one client island is `MeNavbar.tsx`, which
owns the Apply-for-Leave button + drawer and calls `router.refresh()` on
a successful submit so the balance cards and history immediately reflect
the new pending row without a full reload.

### Part B — `/leave/approvals`

**B1 (Approval queue UI).** `app/leave/approvals/page.tsx` rewritten as
a real queue: one `ApprovalCard` per pending request, direct-reports-only
via the exact same `employees!inner(...).eq('employees.reporting_manager_id',
manager.id)` filter the Sprint A scaffold already proved out (no
recursive walk — HR/HR-super-admin additionally see the queue org-wide,
matching the approve/reject routes' own authorization). Balance snapshot
per card reuses A3's `getEmployeeBalanceBreakdown` (one call per
distinct employee in the queue, not per row). Violation badge reuses
`ViolationBadge.tsx` as-is, keyed off `is_lwp_override`.

**B2 (Approve/Reject/Cancel wiring).**
- **Approve** — new route `app/api/leave/approvals/[id]/approve/route.ts`
  authorizes (own manager, or HR) then calls
  `applyLeavePolicyAndMutateBalance({ source: 'manager_approval',
  existingRequestId })`, which was already fully implemented (see the
  prior workstream) — reused unchanged.
- **Reject** — this path genuinely did not exist. Added
  `rejectExistingRequest()` inside
  `applyLeavePolicyAndMutateBalance.ts` (new `manager_reject` source),
  wired through new route `app/api/leave/approvals/[id]/reject/route.ts`
  (requires a comment, same authorization as approve). Moves
  `leave_requests.status` to `'rejected'` — already a valid value in the
  existing schema check constraint, so no migration needed for this
  part — records the comment on an `approval_steps` row, no balance
  touch (rejected rows were never debited), notifies the employee only.
- **Cancellation** — new route
  `app/api/leave/requests/[id]/cancel/route.ts`. Authorizes exactly the
  two roles the prompt names (the request's own employee, or HR/HR-super-
  admin — manager is deliberately not given a separate cancel path here,
  since the plan never lists cancel as a manager action). Blocks
  cancelling a request whose leave has already started. Delegates to the
  existing `cancelExistingRequest()` (source: `'cancellation'`),
  untouched.

### notifyLeaveEvent() — now real

Replaced the no-op stub with `lib/leaveSupabase/notifyLeaveEvent.ts`,
implementing `LEAVE_TRACKER_OVERHAUL_PLAN.md` §6's fan-out matrix
exactly: submitted → manager (+ violation flag); approved → employee +
HR + lead + (whole team if Planned/Casual full-day, else just the
manager — wide vs narrow broadcast); rejected → employee only (+
reason); cancelled → same recipient set the original event used. New
migration `supabase-leave/migrations/004_notifications.sql` adds the
`notifications` table (same wide-open "authenticated read/write" RLS
posture every other table in this project already has — every write
here goes through the service-role client regardless, so this doesn't
widen anything).

**Disclosed scope deviation:** the plan's confirmed assumption #4 asks
for "in-app + email from the start." This implements the in-app half
only. Email needs a provider (Resend/SendGrid/etc.) chosen and an API
key added to `.env` — the plan itself flags that as separate integration
work, and there is no key available in this environment to wire it up
for real. `notifyLeaveEvent.ts` has `// EMAIL:` comments marking exactly
where a send call would go once a provider is picked. This does not
block anything in Parts A/B's own acceptance criteria — every
notification requirement there ("the manager gets a notification",
"only the employee is notified") is about a notification existing at
all, which the in-app row satisfies.

### Verification

- `npx tsc --noEmit` — clean.
- `npx next build` — succeeds (using placeholder Supabase env vars,
  since no live project is reachable from this environment — every
  `/leave/**` route is dynamically rendered (session-dependent), so
  nothing tries to actually connect during the build). 37 routes,
  including the 5 new ones: `/api/leave/me/requests`,
  `/api/leave/me/attendance`, `/api/leave/approvals/[id]/approve`,
  `/api/leave/approvals/[id]/reject`, `/api/leave/requests/[id]/cancel`.
- The prompt's remaining acceptance criteria (matching numbers against
  the live dashboard, a real submit-and-approve round trip, notification
  rows actually landing) need a live Supabase project — not available in
  this sandboxed environment. Everything above was checked as far as
  static typing + build correctness + reading every touched query
  against the real schema (`supabase-leave/schema.sql`) can confirm;
  the migration (`004_notifications.sql`) still needs to be run against
  the live project before `notifyLeaveEvent` can insert anything.

### Files touched this workstream

New:
- `lib/leaveSupabase/getEmployeeAttendanceKPIs.ts`
- `lib/leaveSupabase/notifyLeaveEvent.ts`
- `supabase-leave/migrations/004_notifications.sql`
- `components/leave/PersonalAttendanceReport.tsx`
- `components/leave/LeaveBalanceCards.tsx`
- `components/leave/ApplyLeaveForm.tsx`
- `components/leave/ApplyLeaveDrawer.tsx`
- `components/leave/MeNavbar.tsx`
- `components/leave/ApprovalCard.tsx`
- `app/api/leave/me/requests/route.ts`
- `app/api/leave/me/attendance/route.ts`
- `app/api/leave/approvals/[id]/approve/route.ts`
- `app/api/leave/approvals/[id]/reject/route.ts`
- `app/api/leave/requests/[id]/cancel/route.ts`

Edited:
- `app/leave/me/page.tsx` (Sprint A stub → full Part A assembly)
- `app/leave/approvals/page.tsx` (Sprint A stub → full Part B queue)
- `lib/leaveSupabase/applyLeavePolicyAndMutateBalance.ts` (wired the real
  `notifyLeaveEvent`; added `manager_reject` source +
  `rejectExistingRequest()`)
- `lib/leaveSupabase/getEmployeeBalances.ts` (added
  `getEmployeeBalanceBreakdown` export, additive)
- `components/leave/LeaveHistoryTable.tsx` (added the Status column its
  own row type already had data for)