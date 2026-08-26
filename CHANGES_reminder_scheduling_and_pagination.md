# Changes: reminder scheduling, pagination, notification bug diagnosis

## 1. Automated reminders were actually broken (real bug, now fixed)

`vercel.json` has scheduled a daily cron hitting
`/api/leave/admin/jobs/attendance-escalation-sweep` since the escalation
feature shipped, and `runEscalationSweep()` was fully implemented in
`attendanceEscalation.ts` — but the `JOBS` array in
`app/api/leave/admin/jobs/[job]/route.ts` never listed
`'attendance-escalation-sweep'`. Every day the cron hit that path it got a
404, and nothing ran. **This is why unmarked-leave reminders only ever
went out when someone clicked "Remind" manually.** Fixed by registering
the job — see `app/api/leave/admin/jobs/[job]/route.ts`.

## 2. Immediate reminder the moment a day goes unmarked

`ensureAttendanceExceptionRows` (called whenever HR's Absentees/Half Day
tabs load, and from `/api/leave/attendance/ensure-exceptions`) now
detects genuinely new rows — ones with no `escalation_reminders` entry
yet — and fires an immediate reminder for them right away instead of
waiting for the next cron pass.

## 3. Configurable 48-hour automated interval

New settings on `leave_policy_config` (migration
`0018_reminder_scheduling_config.sql`), editable from **Leave
Configuration → Reminder Scheduling**:

- `reminder_interval_hours` (default **48**) — how often the daily sweep
  re-nudges an open item.
- `final_reminder_day` (default **25**) — see below.
- `manual_reminder_cooldown_hours` (default **24**) — see below.

The sweep now checks `last_reminder_at` against this interval before
sending (`checkReminderGate` in `attendanceEscalation.ts`), instead of
blindly sending once per cron run.

## 4. Guaranteed final reminder on/by the 25th

For any target (unmarked day, pending half-day, pending regularisation)
whose relevant date falls on or before `final_reminder_day` (default the
25th) **of its own month**, a reminder is now guaranteed on that day of
that month regardless of the 48h cadence — it bypasses both the
automatic interval and the manual cooldown, and is marked "final" in the
notification text. A `last_final_reminder_on` column prevents it firing
twice on the same day if both the cron and a manual click land on the
25th.

## 5. HR manual reminder — 24h cooldown

Both HR-facing "Remind" actions now enforce
`manual_reminder_cooldown_hours` (default 24h) since last reminder for
that same target:

- `/api/leave/attendance/remind` (Absentees/Half Day tabs) — via
  `sendEscalationReminder(..., 'manual')`.
- `/api/leave/remind` (Approvals queue's "Send Reminder") — via
  `sendLeaveReminder(..., 'manual')`, checked against the `notifications`
  table's most recent `leave_reminder` row for that target.

Clicking too soon returns a clear error like *"Please wait — the last
reminder for this went out 6.0h ago. HR can send another after 24h (in
~18.0h)."*

## 6. Leave Balances page pagination

`components/leave/EmployeeGrid.tsx` (the "Leave Balances" page under
`/leave/admin`) replaced its "Load more" button with numbered pagination
+ a page-size selector (9/18/30/60), matching `AbsenteesPanel.tsx` /
`HalfDayPanel.tsx` exactly.

## 7. Notifications "not working" — diagnosis, not a code fix

I could not find a code bug in the current notification read path
(`NotificationBell.tsx` + `/api/leave/notifications`) — it's fully wired
and looks correct. The most likely explanations, in order of likelihood:

1. **Migrations out of sync with the live database.** The notifications
   table's `type` check constraint was widened twice after it was first
   created (migration `0012` added `wfh_*` types, `0013` added
   `leave_corrected`). If your live Supabase project is missing either of
   those migrations, any WFH or leave-correction notification insert
   would silently fail against that constraint. **Please tell me which
   migration files have actually been run against your production
   database** — I can't see that from the code alone.
2. There is **no dedicated "Notifications" tab/page** — only the bell
   icon dropdown in the sidebar (`NotificationBell.tsx`, wired into
   `LeaveShell.tsx`). If you expected a full page, that's a feature
   request, not a bug — happy to add one if wanted.
3. If notifications for a *specific* action type (e.g. only WFH, or only
   leave corrections) are missing while others work, that confirms #1.
   If literally nothing appears in the bell for anyone, check the
   browser console/network tab on `/api/leave/notifications` for an
   error response.

## 8. The actual root cause of "remind button not disabling / count stuck at 1"

Found and fixed a real bug in `bumpEscalationReminder` (`attendanceEscalation.ts`):
its `SELECT` query never checked for an error. If migration `0018`
hasn't been run yet on your database, that query — which asks for the
`last_final_reminder_on` column added in that migration — fails
outright. The code treated a **failed query** exactly the same as **"no
reminder has ever been sent for this target,"** which meant:

- Every click looked like the very first-ever reminder, so
  `reminder_count` got reset (not incremented) to `1` every single time.
- The cooldown check had nothing to compare against, so it never
  blocked anything — explaining why the button stayed clickable.

Fixed by splitting the query so core counting/cooldown only depends on
columns that have existed since the original escalation feature
(migration `0015`); the final-reminder-day feature now degrades
gracefully (simply stays off) on a database that hasn't run `0018` yet,
instead of corrupting everything else.

**This means running migration `0018` is not optional — it's required
for cooldowns and reminder counting to work correctly at all**, not
just for the 25th-of-month feature.

## 9. UI was silently swallowing every failed reminder

The Remind button's click handler only updated anything `if (res.ok)`.
On failure — including a legitimate cooldown block — it did nothing and
just quietly re-enabled the button with zero feedback, so a blocked
click and a successful one looked identical. Fixed:

- The server's error message now renders under the row.
- Both `/api/leave/attendance/remind` and `/api/leave/remind` now return
  a `nextAllowedAt` ISO timestamp when they block on cooldown, and the
  button uses it to disable itself and show a live "Available in Xh Ym"
  countdown (re-evaluated every 20s) instead of just going back to
  "Remind" with no explanation.
- This same `nextAllowedAt` is now computed up front when the
  Absentees/Half Day panels first load (via
  `ensureAttendanceExceptionRows`), so a row that's already in cooldown
  (e.g. from the automated sweep) shows that state immediately, not just
  after you click it once and get blocked.

## 10. "Remind All" button

Added to both Absentees and Half Day tabs — sends reminders to every
row currently in view (across the whole filtered set, not just the
current page) in one click, via a new `/api/leave/attendance/remind-all`
endpoint.

**Design decision on cooldown**: there is no separate "bulk cooldown" on
this button. Every target still goes through the exact same manual
24h-cooldown check as the single-row button — someone reminded 2 hours
ago is automatically **skipped**, not counted as a blocking error for
the whole batch. That way "Remind All" is safe to click repeatedly
(e.g. right after narrowing a filter) without HR needing to think about
timing; the per-person rules already handle it. You get a summary like
*"Sent 12 reminders, skipped 3 (already reminded recently or no longer
pending)."*

## 11. Department dropdown on the Acknowledge / Add Employee form

Traced "the ack form" to `NewJoinersPanel.tsx`'s "Acknowledge" button,
which opens `AddEmployeeForm.tsx`. That form already fetched the list of
existing departments (used for the manager's "Departments Managed"
checklist) but the employee's own Department field was still free text —
so two HR staff onboarding people into "Engineering" and "engineering"
would silently create two different departments elsewhere in the app.

Now it's a dropdown of existing departments by default, with a "+ New"
link to fall back to free text for a genuinely new department (and vice
versa, "Choose existing" to switch back).

## 12. Critical regression: reminder storm + hang on "no date picked" view

**This was a real, serious bug I introduced in item 2 above, now fixed.**

The Absentees/Half Day tabs' "no date picked" view (all three tabs share
this same underlying data path) deliberately scans your **entire
uploaded attendance history** to show every unresolved day, however old
— that part is existing, intentional behavior, not something new.

The bug: `ensureAttendanceExceptionRows` treated *any* row without an
`escalation_reminders` entry as "just became unmarked right now" and
fired a real, live reminder for it. Since this feature is brand new,
**every unresolved day across your entire history** had no such entry
yet — so the first time anyone opened the table without a date filter,
it fired genuine reminder notifications for potentially hundreds of
months-old absences all at once, and the resulting burst of concurrent
database calls was very likely what made the page hang at "loading."
This also explains counts like "9 reminders sent" appearing with no
button ever having been clicked.

Fixed with two guards:
- **Recency window**: only a row dated within the last 3 days is treated
  as "just went unmarked." Anything older is left for the ordinary
  automatic sweep (your configured `reminder_interval_hours`) to pick up
  normally — it does not get an immediate blast.
- **Hard cap**: at most 15 immediate sends per batch, and the whole
  upsert+lookup process is now batched in chunks of 200 rows instead of
  one giant request, so even a huge "all history" result set can't
  overwhelm a single database round trip.

**One thing to check on your end**: since the bug already fired before
this fix, some `escalation_reminders.reminder_count` values in your
database may currently be inflated from that storm. Since ACK→LWP
unlocks at `reminder_count >= 3`, an inflated count could make ACK
wrongly available for someone who was never actually reminded three
times on purpose. If you want, run this to see what got hit:

```sql
select target_type, target_id, reminder_count, last_reminder_at
from escalation_reminders
order by reminder_count desc
limit 50;
```

Let me know if you'd like a reset script for anything that looks wrong
here — I didn't run one automatically since I can't see your data and
don't want to guess at which rows are legitimate.

## 13. The real remaining bottleneck — unbounded default date range

**This is very likely why the table view was still hanging even after
fix #12.** It's a separate issue from the reminder storm — it exists
even with reminders working perfectly.

`app/leave/admin/history/page.tsx` (the Leave Tracker page — Absentees /
Half Day / History tabs) initialized its date filters to empty strings.
Empty dates mean "scan the entire uploaded attendance history": every
table involved (`attendance_records`, `leave_requests`,
`workforce_events`, `custom_holidays`, `attendance_exceptions`) gets
paginated through 1000 rows at a time, sequentially, from your very
first uploaded biometric record through today. For any company with
more than a couple months of attendance data, that's a lot of
sequential round trips — and it ran **by default, every time the page
loaded, before anyone touched a filter.** This matches "I have to choose
dates to get that data" exactly.

Fixed by defaulting the Absentees/Half Day tabs to a rolling **60-day
window** instead of unbounded history. A "View full history (may take
longer to load)" link is still there for the (rarer) case of digging
into older backlog, with a "← Back to last 60 days" link to return.

This is the fix most likely to resolve the hang you're still seeing —
the item 12 fix (reminder storm) was real and necessary, but this
unbounded-scan issue is probably the bigger piece of it.

## What you need to do

1. **Run migration `supabase/migrations/0018_reminder_scheduling_config.sql`
   against your Supabase project immediately** — this is no longer just
   for the new 25th-of-month feature; it's required for reminder counts
   and cooldowns to behave correctly at all (see item 8 above).
2. Confirm 0007–0017 have all run too, for the notifications fix in
   item 7.
3. Redeploy so the corrected `vercel.json` cron target actually resolves.
4. Check the new "Reminder Scheduling" section on the Leave Configuration
   page and adjust the three values if 48h/25th/24h aren't what you want.
5. After deploying, click "Remind" once on a test row and confirm the
   button disables itself with a countdown — that confirms the fix took.
