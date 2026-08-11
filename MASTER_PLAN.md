# Master Plan — Chart Scaling, Theming, and Leave Tracker Redesign

This consolidates three workstreams into one sequenced plan. It builds on top
of (doesn't replace) `LEAVE_TRACKER_OVERHAUL_PLAN.md` and `PROGRESS.md`,
which already live in the repo — Sprints A–G referenced below are the same
sprint letters used there, extended with the new items from `Feature.txt`.

**Status:**
- ✅ **Workstream 1 (chart scaling) — done.** See `PROGRESS.md`'s
  "Workstream 1 — Chart scaling fix" entry for exactly what changed
  (`lib/chartLayout.ts` new, `components/Charts.tsx` edited,
  `tsconfig.json` edited to exclude a pre-existing broken backup folder
  that was silently failing `next build`). Verified: `tsc --noEmit` clean,
  `next build` succeeds, 34 routes compiled.
- ⬜ Everything else below is still just planned, not built. **Next up per
  the sequencing in this doc: apply pending Supabase migrations to
  production, then Workstream 2 (dark/light mode), then Leave Tracker
  Sprint B.**

Anyone (human or AI) picking this up should read `PROGRESS.md` top to
bottom first — it's the authoritative log of what's actually been built,
in order, with the reasoning behind each decision. This file is the plan;
`PROGRESS.md` is the record of what happened.

---

## Workstream 1 — Chart scaling across date ranges

**Problem confirmed:** `DailyTrendChart` and `ComparisonTrendChart` in
`components/Charts.tsx` render inside `<ResponsiveContainer width="100%">`
with a fixed height and `interval="preserveStartEnd"` on the X-axis. Every
data point — whether it's 20 days or 200 — gets squeezed into the same pixel
width. Result: points overlap, only the first/last date label survives,
middle months become unreadable. The attendance heatmap (same file, ~line
1109) already solves this correctly with `overflow-x-auto` + a `minWidth`
that scales with the number of visible dates.

**Plan:**
1. **Short range (≤ ~45 days):** keep current daily-point rendering, but
   switch the wrapper to the heatmap's `overflow-x-auto` + scaling
   `minWidth` pattern instead of a fixed 100% width. X-axis `interval`
   changes from `preserveStartEnd` to `"preserveStart"` with a sensible
   tick step so labels don't collide as the range grows toward 45 days.
2. **Long range (> ~45 days, i.e. multiple months selected):** auto-switch
   the same chart to **weekly aggregation** (average attendance rate per
   ISO week) instead of plotting every day. Past roughly 6 months, step up
   again to **monthly aggregation**. This mirrors how most analytics tools
   handle zoom levels and keeps the chart legible at any range instead of
   just scrolling forever.
3. Apply the same fix to **both** `DailyTrendChart` and
   `ComparisonTrendChart` — they currently duplicate the rendering logic, so
   this is also a good moment to extract a shared `useTrendChartLayout(data)`
   hook that returns `{ minWidth, tickInterval, aggregationLevel }` so future
   trend charts (e.g. a leave-tracker calendar trend) don't reintroduce the
   same bug.
4. Add a small "Daily / Weekly / Monthly" toggle so a user can force a
   coarser view even on a short range if they prefer — optional, low effort
   once the aggregation logic exists.

**Size:** small–medium, self-contained, no schema/API changes. Good first
win.

---

## Workstream 2 — Dark / light mode

**Problem confirmed:** no theme support anywhere. Every component hardcodes
Tailwind slate colors (`bg-slate-900`, `text-slate-300`, `border-slate-700`,
etc.) directly — no `dark:` variants, no theme provider, no CSS variables.
There are 100+ instances of this across `components/` and `app/`.

**Plan:**
1. **Foundation:** add a small set of semantic CSS variables in
   `app/globals.css` (e.g. `--bg-surface`, `--bg-elevated`, `--border`,
   `--text-primary`, `--text-muted`, `--accent`) with a dark set (current
   look, becomes the default so nothing regresses) and a light set. Wire
   Tailwind's `dark:` class strategy via a `ThemeProvider` (e.g.
   `next-themes`) so toggling flips a class on `<html>`.
2. **Toggle UI:** a sun/moon switch in the top nav/header, persisted (theme
   preference in `localStorage` for the dashboard app, and for the leave
   tracker once it has real user accounts, on the `employees` row or a
   simple per-user setting so it follows them across devices).
3. **Migration pass:** go file-by-file through `components/` and `app/`,
   replacing hardcoded `slate-*` classes with the semantic tokens from step
   1. This is mechanical but has real surface area — realistically a couple
   of focused sessions, not one sitting. Charts (`recharts` stroke/fill
   colors) need their own pass since those are inline hex values, not
   Tailwind classes — they should read from the same CSS variables via a
   small `useThemeColors()` hook rather than hardcoded hex.
4. **Sequencing note:** it's more efficient to do this **before** building
   the new leave-tracker screens (Workstream 3) than after — new screens get
   built theme-aware from day one instead of needing a second retrofit pass
   right after they ship.

**Size:** medium. Mostly mechanical, spread across many files, no
backend/schema changes.

---

## Workstream 3 — Leave Tracker redesign

Your description matches `LEAVE_TRACKER_OVERHAUL_PLAN.md` closely — that
plan already covers self-login, apply/approve flow, manager & HR dashboards,
and a calendar view. Current actual status, verified against the code:

| Sprint | Scope | Status |
|---|---|---|
| A | Auth & roles, route scaffolding (`/leave/me`, `/leave/team`, `/leave/approvals`, `/leave/admin`) | **Done** |
| B | Employee self-apply form + personal balance/history | Not started |
| C | Manager approval queue (approve/reject, violation flags, balance mutation) | Not started |
| D | Notifications (in-app + email) | Not started |
| E | Calendar view | **Partially done** — `LeaveCalendar.tsx` already exists and is wired into `/leave/admin/history`. Needs to be reused/scoped for `/leave/team` (read-only) and folded into `/leave/approvals` |
| F | Settings → Access & Visibility | Not started |
| G | QA / consistency pass, RLS tightening | Not started |

Below are new sprints to fold in from `Feature.txt`, since those weren't in
the original plan doc:

### New Sprint H — Manager/Lead ↔ Department assignment page
A dedicated admin screen (separate from the employee-adjust modal, per your
note) to manage:
- A manager can be assigned to multiple departments.
- A lead can be assigned to multiple departments.
- A team has one or more employees.
- A manager has no lead above them (only a reporting manager, one level up).
- A lead reports only to a manager (never has their own lead).
- The employee-adjust panel becomes read-only for role/manager/lead info,
  with only **status** (active/inactive/notice-period etc.) editable there —
  relationship changes happen only on this new page.

This maps onto tables that already exist (`department_managers`,
`reporting_lead_id`, `reporting_manager_id`) — it's a UI layer on data that's
already modeled, not a schema redesign. **One blocker to resolve first:**
`Feature.txt` reports a live error — `Could not find the table
'public.department_managers'`. Looking at the code, migration
`0007_department_managers_and_attendance_exceptions.sql` already creates
this table; the error means that migration hasn't been applied to your
actual production Supabase project yet. This needs to be run there before
Sprint H can be tested against real data — it's a deployment step, not new
code.

### New Sprint I — Absentee-driven leave recording (replaces per-card "Record Leave")
Per your note: remove the "Record Leave" button from each employee card and
merge that flow into the absentee list instead, so HR has one place to work
from instead of two.
- HR filters absentees by month, team, and employee search.
- For each absentee, HR records the leave type inline (reuses the existing
  `RecordLeaveForm` logic — no new validation engine needed).
- **Half-day / missed-punch detection:** for any employee whose last punch
  minus first punch is ≤ 5 hours, surface them in a separate accordion
  ("Half-day or missed punch?") rather than the plain absentee list, so HR
  explicitly decides which it is instead of the system guessing. Marking as
  half-day records the leave type; marking as missed punch routes to the
  existing attendance-exception flow (`lib/attendanceExceptions.ts` already
  has the 5-hour threshold constant — reuse it, don't redefine it).
- Once this ships, `EmployeeModal`'s "Record Leave" button and the
  standalone "view profile → record leave" path are removed, since
  everything routes through this screen.

### New Sprint J — Leave policy info button
A small info/help affordance (reusing `InfoTooltip.tsx`, already used
elsewhere in the app) that explains, in plain language: leave types and
rules, how balances/pro-ration are calculated, what a "violation" means and
why it's flagged rather than blocking. Content-only — no new logic, just
surfacing what `lib/leavePolicy.ts` already enforces.

---

## Recommended overall sequencing

1. **Workstream 1 (chart scaling)** — quick, isolated, no risk to anything
   else. Good to knock out first.
2. **Deployment step:** apply migration 0007 (and 0008/0009) to the live
   Supabase project, confirm the `department_managers` error is actually
   gone in production — unblocks Sprint H later and is low effort now.
3. **Workstream 2 (dark/light mode foundation + toggle)** — do this before
   new leave-tracker screens exist, so Sprint B onward is theme-aware from
   the start instead of needing a retrofit.
4. **Leave Tracker, in this order:**
   Sprint B (apply flow) → Sprint C (approval flow) → Sprint I (absentee
   recording, since it removes the old per-card button once B/C establish
   the shared mutation path) → Sprint E completion (calendar reuse for
   team/approvals) → Sprint H (manager/lead assignment page) → Sprint D
   (notifications) → Sprint J (policy info button, small, can slot in
   anywhere) → Sprint F (Settings/visibility) → Sprint G (QA pass).

   Reasoning: B and C are the core loop (apply → approve) everything else
   hangs off of, so they go first. I is sequenced right after because it
   reuses the same balance-mutation service function B/C introduce
   (`applyLeavePolicyAndMutateBalance()` per the original plan's section 7)
   — building it earlier would mean building that function twice. D
   (notifications) depends on events from B/C/I existing to notify about,
   so it comes after, not before.

5. **Dark/light mode migration pass** (the mechanical file-by-file part)
   can happen in parallel with the leave tracker sprints once the
   foundation from step 3 is in — it doesn't block anything else.

---

## Open questions before implementation starts

1. **Chart aggregation thresholds** — are 45 days / 6 months reasonable
   cutoffs for daily → weekly → monthly, or do you have a preference?
2. **Theme default** — dark stays default (matches current look, zero
   regression risk) with light as opt-in — confirm that's right, or do you
   want light as the default going forward?
3. **Sprint H's role constraints** — confirmed as written above (manager: no
   lead, has a reporting manager; lead: only a manager above) — any
   exceptions to that (e.g. a manager who is also someone's lead) that
   should be modeled instead of assumed away?
4. **Production Supabase access** — do you want me to walk through applying
   the pending migrations, or is that something you'll run yourself /
   through your existing deploy process?

Once these are confirmed, I'd start with Workstream 1 (chart fix) since it's
fully self-contained and has no open questions blocking it.
