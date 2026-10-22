# SaaS Readiness To-Do List: BioMetric Dashboard

_Prepared from the repo review, 22 Oct 2026._
_P0 = blocks selling to a second customer. P1 = needed before public launch. P2 = needed for scale. ✔ = confirmed in your code; other items are standard requirements for this type of product._

---

## Suggested Order

- [ ] **Weeks 1–3:** Section A (security) plus tests, CI and Dockerfile fixes from Section I
- [ ] **Weeks 3–8:** Sections B (multi-tenancy) and C (hardcoding), plus the quick wins in N2 and N4 (hide empty widgets, explicit day toggle, holiday state)
- [ ] **Weeks 6–14:** Section D (leave policy engine), Section G (onboarding), Section N1 (dashboard config)
- [ ] **Pilot with 1–3 customers** using concierge onboarding; let them decide how much of E, F, L and N3 to build first
- [ ] **Before general availability:** H (billing), K (compliance), M (customer success), rest of I, J, N3, N5
- [ ] **Later:** live day view via device sync (E, N4), dedicated-database tier, SOC 2

---

## A. Security and Data Protection (P0)

- [ ] ✔ Replace the blanket "authenticated read/write" RLS policy on all tables with role- and row-based policies
- [ ] ✔ Block role self-escalation: only HR admins may change `employees.role`, enforced in the database
- [ ] ✔ Remove the `shared_links` `public select using (true)` policy
- [ ] ✔ Require an HR session on `POST /api/shared-link`; add payload size limit and rate limit
- [ ] ✔ Add authorization and a batch limit to `/api/dashboard/leave-lookup-batch`; stop returning leave reasons to unauthorized roles
- [ ] ✔ Audit all 37 files using the service-role client; each must verify the caller and scope queries to their organization
- [ ] ✔ Replace `xlsx@0.18.5` (high-severity advisories, no npm fix); re-run `npm audit` and clear the remaining 8 findings
- [ ] ✔ Use timing-safe comparison for `CRON_SECRET` and add it to `.env.example`
- [ ] Rate limiting on login, upload and API routes
- [ ] Security headers (CSP, HSTS, frame options)
- [ ] File upload validation: size limit, type check, malicious-spreadsheet handling
- [ ] Expiry cleanup for shared links; let admins revoke them
- [ ] Secret scanning and dependency scanning in CI
- [ ] Independent penetration test before enterprise sales (P1)
- [ ] Revoke the GitHub token that was pasted in chat, and never commit tokens

---

## B. Multi-Tenancy Foundation (P0)

- [ ] Create an `organizations` table with membership and plan fields
- [ ] Add `org_id NOT NULL` to every tenant table (`employees`, `attendance`, `leave_*`, `balances`, `holidays`, `notifications`, `WFH`, `FnF`, `offices`, `settings`, `uploads`, `mappings`, etc.)
- [ ] Tenant-isolation RLS on every table using an `auth_org_id()` helper
- [ ] ✔ Make `leave_policy_config` and `dashboard_settings` per-organization (both are single-row today)
- [ ] Scope unique constraints per org, e.g. `(org_id, employee_code)`
- [ ] Composite indexes starting with `org_id`
- [ ] Make every cron job loop per organization, with failure isolation per tenant
- [ ] Make notifications, emails and exports org-aware
- [ ] Automated cross-tenant test suite (log in as org A, try to read/write org B) that must pass in CI
- [ ] Migration plan to move WonderBiz's existing data into organization #1 without downtime
- [ ] Dedicated-database option for enterprise customers (P2)

---

## C. Remove Hardcoding (P0/P1)

- [ ] ✔ `COMPANY_EMAIL_DOMAIN` default `wonderbiz.in`: move to per-org allowed domains
- [ ] ✔ Offices (Mumbai, Hyderabad): per-org office table; finish the canonical-offices work from migration 0021
- [ ] ✔ Hardcoded leave type codes (about 170 occurrences): drive from data
- [ ] ✔ Financial-year logic (`fyStartYearForDate`) and the 25 March reset in `vercel.json`: per-org leave year and reset date
- [ ] ✔ Probation unlock (4 months) and notice-period default (30 days): per-org or per-policy
- [ ] Holiday lists: per-country templates that each org can edit
- [ ] Shift times and grace periods: per office, plus per department or shift (night and rotating shifts)
- [ ] Replace "WonderBiz" text in UI, emails, PDFs and page titles with org name and logo
- [ ] Reminder timings, escalation rules and KPI thresholds: per org
- [ ] Time zones: remove any India-time assumption; store a time zone per office
- [ ] ✔ Remove hardcoded word "department" and the `Unknown` placeholder handling (see N1)

---

## D. Leave Policy Engine (P0 for the first customer that differs from WonderBiz)

- [ ] ✔ Remove the `leave_types.code` check constraint (SL, CL, PL, LWP only) so organizations can define their own types
- [ ] Create `leave_policies`, `leave_rules` and `policy_assignments` tables with effective-dated versions
- [ ] Rule types: entitlement, accrual timing, carry-forward, eligibility, application limits, notice tiers, documentation, approval chain, fallback behavior, leave year
- [ ] ✔ Move probation accrual and annual-reset logic out of fixed SQL functions into parameterized rules
- [ ] ✔ Split `applyLeavePolicyAndMutateBalance.ts` (1.4k lines) into a pure `evaluateLeaveRequest()` and a thin write layer
- [ ] Regression suite proving the new engine reproduces WonderBiz's current results exactly (the gate before moving on)
- [ ] Policy templates: India standard, statutory leave, US-style PTO, simple annual quota
- [ ] Policy editor UI with validation and a "simulate this policy" preview
- [ ] Multiple policies per organization, assigned by office, employee type or department
- [ ] Record the policy version on every leave request; never recalculate history
- [ ] Configurable approval chains: skip levels, delegation, out-of-office approver
- [ ] More leave types: maternity, paternity, comp-off, bereavement, optional holidays
- [ ] Collect real leave policy documents from 3–5 prospects before finalizing the rule types

---

## E. Attendance Data Ingestion (P1)

- [ ] Store saved column mappings and device format templates per organization
- [ ] Vendor template library (ZKTeco, eSSL, Matrix, Realtime, Hikvision and others common in your market)
- [ ] Import validation and error reports: duplicate punches, unknown employees, bad dates, overlapping uploads, with a preview before saving
- [ ] Idempotent re-uploads; correct a previously uploaded month
- [ ] Large files: chunked parsing, progress display, background processing instead of the browser tab
- [ ] Shifts that cross midnight, multiple punches per day, missed punches
- [ ] Matching rules between device IDs and employee codes, with an unmatched-IDs screen
- [ ] Make the department/group column optional in the mapping step; support group and hierarchy mapping
- [ ] Track and display "data last updated" time for day view
- [ ] ✔ Verify where data really lives (`lib/storage.ts`, `employeeStore.ts`); confirm no browser-only paths bypass the database
- [ ] API or small sync agent so devices push punches automatically (P2)

---

## F. Authentication and User Management (P1)

- [ ] Email and password login with email invites for organizations not using Google
- [ ] Microsoft 365 login in addition to Google
- [ ] SAML or OIDC SSO for enterprise (Supabase supports it on paid plans)
- [ ] Multi-factor authentication option
- [ ] Per-org settings for allowed login methods and domains
- [ ] Offboarding: deactivate users, revoke sessions, keep history
- [ ] Users belonging to more than one organization (consultants, group companies)
- [ ] Optional custom roles and permissions beyond employee, lead, manager, HR, super admin
- [ ] Session and password policies (length, expiry, lockout)

---

## G. Onboarding and Admin Experience (P1)

- [ ] Organization signup flow with email verification
- [ ] Guided setup wizard: company, offices, holidays, leave policy, login method, how people are grouped (departments, teams, branches or none), employees, first upload
- [ ] Employee CSV import with validation and a downloadable template
- [ ] Opening-balance import
- [ ] Demo mode with sample data so prospects can try the dashboard first
- [ ] Org settings page: branding, time zone, language, data retention
- [ ] Platform super-admin console: list tenants, usage, plan, suspend, controlled support access with an audit trail
- [ ] In-app help, tooltips and an empty state on every screen
- [ ] Move `scripts/bulk-create-employee-auth.mjs` out of the customer path or turn it into an admin feature

---

## H. Billing and Plans (P1)

- [ ] Choose a processor: Razorpay (India, GST invoicing) and/or Stripe (international)
- [ ] Plans, trial period, per-employee pricing and monthly minimums
- [ ] Feature flags by plan (SSO, API, audit log, advanced analytics)
- [ ] Usage metering (active employees) with automatic invoice adjustments
- [ ] Failed-payment handling: grace period, downgrade, read-only mode, then suspension
- [ ] Customer billing portal: invoices, payment method, plan change, cancel
- [ ] Tax handling: GST, VAT and tax IDs

---

## I. Reliability and Operations (P0/P1)

- [ ] ✔ Fix or remove the Dockerfile: add `output: standalone` to `next.config.ts`, create or remove the `public/` copy, add `/api/health`
- [ ] Decide and document the hosting strategy (Vercel plus Supabase is fine to start)
- [ ] Separate staging and production environments
- [ ] CI on every pull request: lint, type-check, tests, build, audit
- [ ] Tests: unit tests for leave and attendance math, API authorization tests, end-to-end tests for core flows
- [ ] Error tracking (Sentry), uptime monitoring and a public status page
- [ ] Structured logging with no personal data in logs
- [ ] Database backups with a tested restore; point-in-time recovery enabled
- [ ] Migration discipline: ordered, reversible where possible, tested on production-sized data
- [ ] ✔ Add the missing files referenced in `.env.example` (`unified_schema.sql`, `lib/googleWorkspace.ts`) or remove the references
- [ ] Background job queue for heavy work (imports, bulk emails, reports), not only cron
- [ ] Performance: pagination, indexes, remove N+1 query patterns (e.g. `leave-lookup-batch`)
- [ ] Load test at target size (e.g. 5,000 employees and 12 months of punches per org), including dashboard load-time targets

---

## J. Code Quality and Maintainability (P1)

- [ ] ✔ Rewrite the README: it still describes a no-backend, localStorage-only, Basic-auth app
- [ ] ✔ Reduce `any` types (114 uses) and enable strict type checking
- [ ] ✔ Break up very large files: `DashboardClient` (1.7k lines), `Charts` (1.9k), policy engine (1.4k), `attendanceEscalation` (0.9k); split along widget-registry boundaries
- [ ] Consolidate duplicated logic between Dashboard and Leave Tracker (two Supabase client sets, two theme systems)
- [ ] ✔ Clean up stray or dead files (e.g. `app/api/leave/admin/fnf-route.ts` next to `fnf/route.ts`)
- [ ] Consistent API error format and Zod input validation on every route
- [ ] Architecture decision log

---

## K. Compliance, Legal and Trust (P0 before signing contracts)

- [ ] Terms of service, privacy policy, Data Processing Agreement, subprocessor list (Supabase, Vercel, email provider)
- [ ] India DPDP Act compliance; GDPR if selling to EU organizations
- [ ] Data subject rights: export, correction and deletion of an employee's data
- [ ] Per-org data retention settings and deletion at contract end
- [ ] Immutable audit log: who changed leave, balances, roles, settings and exports, and when
- [ ] Data residency decision (which region holds the data)
- [ ] Encrypt sensitive fields where appropriate (leave reasons can contain health information)
- [ ] Roadmap to SOC 2 or ISO 27001 (P2)
- [ ] IP ownership: get written confirmation that you own or may license the code, given it was built for WonderBiz
- [ ] Trademark and name check for the product

---

## L. Localization (P1/P2)

- [ ] Per-org date formats, week start day and weekends (some countries use Friday–Saturday)
- [ ] Number and currency formats
- [ ] Multiple UI languages (start with English; plan Hindi and others)
- [ ] Country-specific statutory leave and holiday templates

---

## M. Customer Success and Sales Readiness (P1)

- [ ] Marketing website with pricing, features and a security page
- [ ] Help center, getting-started videos and import guides
- [ ] Support process: email or chat, response-time targets, escalation path
- [ ] In-app feedback and privacy-respecting product analytics to see where onboarding stalls
- [ ] Brandable email notification templates
- [ ] Sales collateral: security questionnaire answers, DPA, one-page architecture and data-flow description
- [ ] Customer data export so nobody feels locked in
- [ ] Pilot agreement template with feedback commitments and a discounted rate
- [ ] Decide pricing: per employee per month with a minimum, tiered features, 14–30 day free trial

---

## N. Dashboard Adaptability: Teams, Scale and Day View

> **Note:** Behavior in N2–N4 was inferred from reading the code and is untested.

### N1. Configuration-Driven Layout (P1)

- [ ] Per-org `dashboard_config` table: grouping dimension, UI label, default view, enabled widgets, minimum group size for rates, maximum comparison groups
- [ ] ✔ Rename "department" to a generic "group" in `types.ts`, hooks, charts and filters; show each customer's own label (Department, Team, Branch, Project)
- [ ] Widget registry: each panel declares the data it needs and renders only when that data exists
- [ ] Role presets: HR sees everything, managers see their groups, executives see a summary-only view

### N2. Organizations with No Teams (P0/P1)

- [ ] ✔ Stop department widgets showing empty or as a single "Unknown" bar (blank and "Unknown" departments are skipped in the charts today)
- [ ] Hide department filter, department chart, department trend, comparison mode and team snapshot when no group data exists
- [ ] Promote the employee table, individual comparison, late and absent rankings and office comparison instead
- [ ] Clear message when the upload has no department column
- [ ] Ways to add teams later: import with employees, by reporting manager, or a mapping step

### N3. Organizations with Many Teams (P1; performance P2)

- [ ] Top and bottom N teams by default in bar charts, with sorting and a "show all" toggle
- [ ] Heatmap with teams as rows and dates as columns, scrollable
- [ ] Searchable team filter grouped by hierarchy
- [ ] ✔ Cap comparison mode (it starts from any 2 or more departments today) with a ranked-table fallback
- [ ] Parent and child groups (Division > Department > Team) with roll-up totals
- [ ] ✔ Extend the manager team-scoped view (managedDepartments, teamCodes) with a team switcher and an "all my teams" total
- [ ] Suppress or flag rates for groups under the minimum size (e.g. fewer than 3–5 people)
- [ ] ✔ Move aggregation to the server or database views; today all records are loaded and calculated in the browser (`useDashboardData.ts`)
- [ ] Paginate employee tables and large panels

### N4. Single-Day Dashboard (P1; live data P2)

- [ ] ✔ Keep the existing single-day mode, and make view mode an explicit toggle instead of a side effect of filters
- [ ] Date picker with Today, Yesterday and Previous working day shortcuts
- [ ] Per-org default landing view (Today, Month or Comparison)
- [ ] "Holiday / weekly off, no attendance expected" state instead of 0% attendance
- [ ] Day view content: expected vs present, absent without leave, on leave, WFH, late arrivals with times, early departures, missed punches, team snapshot, optional arrival timeline
- [ ] Live "today" data via the device sync API (see E); until then, show when data was last updated

### N5. Fixture Tests for Dashboard Variants (P1)

- [ ] Fixtures: one office with no departments; 5 teams and about 50 people; 80 teams and about 3,000 people; a team of 1–2 people; holiday and weekly-off dates; a manager with 3 teams
- [ ] Assert: no empty charts, rate suppression works, performance stays within target, day-view states are correct

---

## O. Platform Master Console (P0/P1/P2)

_Build after Section B (multi-tenancy). This is the control room for your business._

### Checklist

- [ ] `platform_admins` table with roles (owner, support, finance, read-only), kept separate from `employees` (P0)
- [ ] Separate login and route area (/master/* with its own gate in proxy.ts); MFA required for every platform admin; optional IP allowlist (P0)
- [ ] Platform-admin check on every master route and API, with tests that tenant admins (including hr_super_admin) get 403 (P0)
- [ ] Append-only `platform_audit_log` for every master action (P0)
- [ ] Organizations list: name, plan, status (trial, active, past due, suspended, cancelled), signup date, country, employee count against plan limit, last login, last attendance upload; search, filters, sorting (P1)
- [ ] Organization detail page: admin contacts, plan and billing status, trial end date, usage over time, configuration summary (offices, groups, leave policy), health (failed imports, failed cron jobs, errors) (P1)
- [ ] Actions: suspend and reactivate (typed confirmation), extend trial, change plan or limits, resend admin invite, reset admin access (P1)
- [ ] onboarding_progress tracking and onboarding funnel view (P1)
- [ ] Nightly usage_snapshots job so the master page reads small summary rows and never scans raw customer data (P1)
- [ ] Support notes per organization (org_notes) (P1)
- [ ] Consent-based, time-limited, read-only impersonation with a visible banner and audit trail (support_access_grants) (P1)
- [ ] Per-organization feature flags (P1)
- [ ] Organization data export and deletion workflow with typed confirmation, ideally a second approver (P1)
- [ ] Make suspended organizations unable to log in or call APIs, with a test (P0)
- [ ] Platform metrics: MRR, trial conversion, churn, total employees (P2)
- [ ] System health and failed-job monitoring (P2)
- [ ] Announcements and maintenance notices to all or some organizations (P2)
- [ ] Alert on every platform-admin login; keep a reviewed list of who has platform access (P1)

### Design Rules

- Never use a customer role for platform access.
- Metadata and aggregates only — no employee-level data on the master page.
- Impersonation only with consent: time-limited, read-only, with a visible banner and audit trail.
- Service-role client only inside this area, after the platform-admin check on every request.
- Destructive actions need a typed confirmation, and ideally a second approver.
- Rate limit the master area.

### Suggested Data Model

```
platform_admins        (user_id, role, mfa_required, created_at)
organizations          (... status, plan, trial_ends_at, suspended_at)
onboarding_progress    (org_id, stage, completed_at per step)
usage_snapshots        (org_id, date, active_employees, uploads, leave_requests, ...)
support_access_grants  (org_id, granted_by, platform_admin_id, expires_at, scope)
platform_audit_log     (id, platform_admin_id, org_id, action, details, at)
org_notes              (org_id, author, note, at)
```

### Build in Versions

- [ ] Version 1 (pilots): organization list, detail page, suspend/reactivate, audit log.
- [ ] Version 2: onboarding funnel, usage snapshots, notes, trial extension, feature flags.
- [ ] Version 3: billing metrics, health monitoring, consent-based impersonation, announcements.

---

## Part 2: Prompts for Your AI Coding Agent

### How to Use

- [ ] Save the master prompt below as `CLAUDE.md` in the repo root so every session follows it automatically
- [ ] Give ONE section per session (for example: Do Section A), never everything at once
- [ ] Review each branch yourself before merging; run the WonderBiz regression tests and cross-tenant tests as the gates
- [ ] Have someone who knows Postgres review every migration and RLS change
- [ ] Test migrations on a separate production-like Supabase project, never on the live one

### Follow-Up Prompts for Each Session

- [ ] Session 1: Do Section A. Plan first, then wait for my approval before touching RLS or auth.
- [ ] Session 2: Do Section I: test setup, CI, Dockerfile fix. No UI changes.
- [ ] Session 3: Do Section B (multi-tenancy) with the cross-tenant test suite. Plan the migration for moving WonderBiz into organization #1 first.
- [ ] Session 4: Do Section C (remove hardcoding), one sub-bullet at a time, with WonderBiz regression checks.
- [ ] Session 5: Do Section O version 1 (platform master console), using the Section O prompt below.
- [ ] Session 6: Do N2 and N4 quick wins (hide empty widgets, explicit day toggle, holiday state). Provide screenshots at all three widths in both themes.
- [ ] Session 7: Do Section D, starting only with removing the leave type code constraint and extracting the pure evaluateLeaveRequest function, with the WonderBiz regression suite as the gate.
- [ ] Later sessions: G, E, F, H, K, M, then the rest of I, J and N, one at a time.

### Tips for Good Results

- Keep each session small. A prompt that says "do everything" produces a half-done mess.
- Review database changes yourself. Mistakes there are the hardest to undo.
- Keep the theme and responsiveness rules in CLAUDE.md so they apply even when you forget to repeat them.
- Do not merge until lint, type-check, build, tests and screenshots all pass.
- Take your own backup of the database before running any migration on a real environment.
