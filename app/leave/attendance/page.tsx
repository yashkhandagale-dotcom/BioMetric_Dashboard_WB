import { CalendarClock } from 'lucide-react';
import LeavePageHeader from '@/components/leave/LeavePageHeader';
import MyAttendanceExceptions from '@/components/leave/MyAttendanceExceptions';

// Feedback item: "Attendance days that need your input" used to be a
// card wedged between the balance cards and WFH panel on /leave/me —
// easy to miss, and visually it didn't match the rest of the page (a
// full-bleed amber alert box next to neutral white cards). It's now its
// own tab with its own page and header, same as every other section.
export default function LeaveAttendancePage() {
  return (
    <div className="max-w-3xl space-y-8">
      <LeavePageHeader
        title="Attendance"
        description="Days that don't match your usual attendance pattern — let us know what happened before they convert to Leave Without Pay."
      />

      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          Unresolved exceptions auto-convert to Leave Without Pay after the
          review window closes. Responding takes less than a minute per day.
        </p>
      </div>

      <MyAttendanceExceptions />
    </div>
  );
}