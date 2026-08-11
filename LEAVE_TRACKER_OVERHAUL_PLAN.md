# Leave Tracker Overhaul — End-to-End Plan

**Status: assumptions confirmed, Sprint A in progress.**

Confirmed answers to the 5 assumptions in section 1 below:

1. **Manager-only approval** — confirmed as written. Lead is notified, not a gate.
2. **Policy violations flag, don't block** — confirmed as written.
3. **"Team" for broadcast = same reporting manager/department** — confirmed as written.
4. **Notifications: in-app + email from the start** (changed from the plan's
   original "in-app only for v1" default). This adds an email-sending
   integration to Sprint D's scope — a provider (e.g. Resend/SendGrid) will
   need to be chosen and its API key added to `.env` when that sprint starts.
5. **HR keeps manual leave entry via the existing `RecordLeaveForm` flow** —
   confirmed as written.

---

## 0. Baseline audit (what your zip already has)

Good news first: the backend was already built for most of this, it's just not wired to a UI yet.

- **`supabase-leave/schema.sql`** already has `employees` (with `role`: employee / lead / manager / hr / hr_super_admin, `reporting_lead_id`, `reporting_manager_id`), `leave_types`, `leave_balances`, `balance_transactions`, `statutory_leave_records`, **`leave_requests`**, and **`approval_steps`** (lead → manager → HR sequence). There's also a full policy engine (pro-ration, notice-tier checks, LWP conversion) already in SQL functions.
- **`/api/leave/employees/requests`** already exists and is called by `RecordLeaveForm.tsx` — but that form is launched *by HR* (from the admin grid / employee modal), not by the employee themselves. There's no employee-facing "Apply for Leave" screen yet.
- **Auth today is single-tier**: `app/leave/admin/layout.tsx` says explicitly — *any* authenticated user in the leave-tracker Supabase project is treated as HR super admin. There is no lead/manager/employee login split yet, even though the `role` column already exists.
- **No notifications table anywhere** in the schema — this is a genuine gap to add.
- **No calendar view** — the closest thing is `app/leave/admin/history` (a table) and the KPI/heatmap views on the attendance dashboard side, which is a different app/DB entirely.
- **Policy violations already have a UI hook**: `ViolationBadge.tsx` + `is_lwp_override` / `lwp_override_reason` columns exist — just needs to be surfaced in the new approval screen.

So the heavy lift is: **auth/roles, the employee/manager self-service UI, the approval workflow, notifications, and the calendar view.** The balance math and violation detection don't need to be reinvented — they need to be reused consistently everywhere instead of only from the HR admin form.

---

## 1. Assumptions (see confirmed answers above)

1. **Manager is the sole approver.** Lead is *notified* on every application/approval for their team, but does not block/approve. (Schema has a 3-step lead→manager→HR chain available if you actually want lead to approve too — easy to turn on later.)
2. **Policy violations flag, they don't block.** Employee can still submit; the manager sees a red remark and decides. (Toggle-able later in Settings if you want hard blocks for specific violation types.)
3. **"Team" for broadcast = employees sharing the same reporting manager/department**, not the whole company.
4. **In-app notifications only for v1** (a bell/inbox in the app). Email/Slack can be layered on after, since it's a separate integration. — *Superseded: email is now in scope from Sprint D, not deferred.*
5. **HR keeps the ability to record leave on an employee's behalf** (existing `RecordLeaveForm` flow) alongside the new self-service flow — useful for backdated entries, biometric-derived absences, etc.

---

## 2. Roles & what each one sees

| Role | Dashboard scope | Can apply? | Can approve? | Extra |
|---|---|---|---|---|
| **Employee** | Own balance, own history, own calendar | ✅ | ❌ | Gets notified on approval/rejection |
| **Lead** | Own data + read-only view of direct reports' leave | ✅ (own) | ❌ | Notified whenever a team member applies/gets approved |
| **Manager** | Own data + all departments they manage (via existing `department_managers` table) | ✅ (own) | ✅ (their reports) | Sees pending-approval queue with violation flags |
| **HR** | Everything — calendar, balances, analytics, org, violations, settings | ✅ (own, optional) | ✅ (can override anywhere) | Owns Settings → Access & Visibility |

This maps directly onto the `role` column and `reporting_lead_id` / `reporting_manager_id` / `department_managers` that already exist — no new hierarchy modeling needed.

---

## 3. Auth model change

**Today:** one shared HR login; anyone who signs in is treated as super admin.

**Target:**
- Every employee gets a real Supabase Auth account, linked via `employees.auth_user_id` (column already exists, just unused).
- `app/leave/admin/layout.tsx`'s guard changes from "is there a user?" to "look up this user's `employees.role` row and branch."
- Route restructure:
  - `/leave/me` — employee self-service (apply, balance, history, personal calendar)
  - `/leave/team` — lead's read-only team view
  - `/leave/approvals` — manager's pending-approval queue
  - `/leave/admin/*` — HR (existing pages, kept, extended with the calendar)
- One login page (`/leave/login`), post-login redirect decided by role instead of hardcoded to `/leave/admin`.

*(Sprint A status: done — see PROGRESS.md's "Sprint A" entry.)*

---

## 4. The calendar view (the headline UI change)

This replaces/extends today's table-based "Leave Tracker" (`/leave/admin/history`) with a real calendar, visible to HR (full org) and to leads/managers (scoped to their team).

- **Month grid** (Google-Calendar-style), with a week-view toggle.
- Each date cell shows small colored markers per employee on leave that day — color-coded by leave type (Sick / Casual / Planned / LWP / Half-day), with avatars/initials, collapsing to "+N more" past 3–4.
- **Click a date → side drawer opens**, listing every employee on leave that day: name, department, leave type, status (approved vs pending shown differently — e.g. solid vs striped), and a link into their record.
- Filter bar: department, office, leave type, employee search.
- Optional overlay toggles: holidays (already in `predefinedHolidays.ts`) and `workforce_events` (WFH / business travel / office shutdown), which already exist as a separate type so they render as a distinct visual layer, not mixed into leave.
- **Data source:** `leave_requests` joined to `leave_types`, filtered where the clicked date falls between `start_date` and `end_date`. No new table needed — this is a read/aggregation layer on top of what already exists.

---

## 5. End-to-end flow

### 5a. Planned / Casual leave
1. Employee logs in → `/leave/me` → **Apply for Leave** → picks type, date range (or half-day), reason, action plan (required for Planned per existing schema).
2. On submit, the existing policy engine runs (notice period, max consecutive days, etc.). If a violation is found, the request still saves, but flagged with `is_lwp_override`/policy note — same mechanism `ViolationBadge` already renders.
3. A `leave_requests` row is created (`status = pending`). A notification is created for the **manager** — "red remark" shown inline if policy was violated.
4. Manager opens `/leave/approvals`, sees the request card with the employee's current balance snapshot and the violation badge if present, and approves or rejects (with an optional comment).
5. **On approval:**
   - `balance_transactions` gets a `leave_approved` debit row → `leave_balances.closing_balance` recomputes automatically (already a generated column).
   - Notifications fan out to: the employee, HR, the lead, **and the employee's team** (planned/casual only) — "X is on leave on [dates] — [reason]".
   - The calendar (HR + team view) reflects it immediately since it reads live from `leave_requests`.
6. **On rejection:** only the employee is notified, with the manager's comment as the reason. No balance change, no team broadcast.

### 5b. Sick leave (and other non-broadcast types: LWP, half-day-sick)
Same steps 1–4, but at approval time the notification fan-out is **narrow**: employee, HR, lead, and the approving manager only — no team-wide broadcast. This protects medical privacy while still keeping the people who need to know (workload planning, HR record-keeping) in the loop.

### 5c. Cancellation
Employee (or HR) can cancel an approved/pending request before it starts. This reverses the balance transaction (`leave_cancelled` credit) and notifies whoever was notified on approval (manager, HR, lead, and team if it was broadcast).

---

## 6. Notification matrix

| Event | Recipients | Broadcast scope |
|---|---|---|
| Employee applies | Manager (with violation flag if any) | — |
| Manager approves — Planned/Casual | Employee, HR, Lead, **whole team** | Wide |
| Manager approves — Sick/LWP/Half-day | Employee, HR, Lead, Manager | Narrow |
| Manager rejects | Employee (+ reason) | — |
| Request cancelled | Employee, Manager, HR, Lead (+ team if it was broadcast) | Matches original |

Implementation: one new `notifications` table (`recipient_employee_id`, `type`, `title`, `body`, `leave_request_id`, `is_read`, `created_at`), written by a single server-side function every mutation path goes through — so the fan-out rules live in one place, not duplicated per screen. Each row also drives an email send (per the confirmed "in-app + email" scope) via whatever provider is picked in Sprint D.

---

## 7. Keeping balances consistent everywhere

Right now `RecordLeaveForm` is the only path that touches balances, via HR. Once employees can self-apply and managers can approve, there will be multiple entry points — so:

- **Single service function** (e.g. `applyLeavePolicyAndMutateBalance()`) is the *only* thing allowed to write to `leave_balances` / `balance_transactions`, called by: employee apply, manager approve/reject, HR manual entry, cancellation. No screen writes balances directly.
- Every page that displays a balance (employee dashboard, manager approval card, HR grid, calendar tooltips) reads from the same `leave_balances` table — so after any mutation, a `revalidatePath` on the relevant routes keeps them in sync instead of each screen caching its own copy.

---

## 8. Settings → Access & Visibility (new HR-only tab)

This is where the "who can view what" configurability you asked for lives, instead of being hardcoded:

- Whether leads can see reason/notes text for their team's leave, or just "on leave" with no detail.
- Whether policy violations should **block** submission outright for specific leave types, vs. just flag (default: flag).
- Whether approval requires lead sign-off before manager (turns on the second step of the existing `approval_steps` chain) vs. manager-only (default, per assumption #1 above).
- Which leave types broadcast to the team on approval (default: Planned + Casual only, per section 6) — editable per leave type in case you want to change that later.

---

## 9. Delivery plan (sprints)

| Sprint | Scope | Status |
|---|---|---|
| **A — Auth & Roles** | Per-employee Supabase Auth accounts, `auth_user_id` linking, role-aware route guards, `/leave/me` `/leave/team` `/leave/approvals` scaffolding | **In progress — see PROGRESS.md** |
| **B — Apply flow** | Employee-facing apply form (reuses policy engine + violation detection already in the API), personal balance/history views | Not started |
| **C — Approval flow** | Manager's pending-approval queue, approve/reject, balance mutation wired through the single service function, cancellation | Not started |
| **D — Notifications** | `notifications` table, in-app bell/inbox UI, fan-out rules per the matrix above, **plus email sending** | Not started |
| **E — Calendar view** | Month/week grid, click-to-drill-down drawer, filters, holiday/WFH overlay toggle — for HR (full org) and lead/manager (scoped) | Not started |
| **F — Settings** | Access & Visibility tab, violation block/flag toggle, broadcast-scope toggle per leave type | Not started |
| **G — QA / consistency pass** | Verify balances match everywhere, regression-test existing HR admin pages (Analytics, History, Violations, Bulk Events, Organization) still work unchanged, tighten RLS from the wide-open policy flagged in Sprint A | Not started |

Each sprint is independently shippable and testable, same cadence as the existing `PROGRESS.md` sprint log.
