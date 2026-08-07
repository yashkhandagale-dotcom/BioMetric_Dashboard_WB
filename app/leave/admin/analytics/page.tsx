import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import LeaveAnalytics from '@/components/leave/LeaveAnalytics';

// Was previously always rendered inline at the bottom of /leave/admin —
// moved to its own route behind a top-nav button so the main balances/
// employees page stays focused and doesn't run analytics queries on
// every load of the primary admin screen.
export default async function LeaveAnalyticsPage() {
  const fyStartYear = getFYStartYear();

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] p-8 space-y-6">
      <div className="space-y-2">
        <p className="text-[var(--text-muted)] text-xs uppercase tracking-[0.24em]">Reports</p>
        <h1 className="text-2xl font-semibold">Leave Analytics — {formatFYLabel(fyStartYear)}</h1>
      </div>

      <LeaveAnalytics fyStartYear={fyStartYear} />
    </div>
  );
}