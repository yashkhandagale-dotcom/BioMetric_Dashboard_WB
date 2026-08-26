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

## What you need to do

1. **Run migration `supabase/migrations/0018_reminder_scheduling_config.sql`**
   against your Supabase project (and confirm 0007–0017 have all run too,
   for the notifications fix above).
2. Redeploy so the corrected `vercel.json` cron target actually resolves.
3. Check the new "Reminder Scheduling" section on the Leave Configuration
   page and adjust the three values if 48h/25th/24h aren't what you want.
