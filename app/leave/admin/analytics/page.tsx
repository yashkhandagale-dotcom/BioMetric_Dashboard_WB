import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import LeaveAnalytics from '@/components/leave/LeaveAnalytics';

// Was previously always rendered inline at the bottom of /leave/admin —
// moved to its own route behind a top-nav button so the main balances/
// employees page stays focused and doesn't run analytics queries on
// every load of the primary admin screen.
export default async function LeaveAnalyticsPage() {
  const fyStartYear = getFYStartYear();

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Leave Analytics — {formatFYLabel(fyStartYear)}</h1>
        <a href="/leave/admin" className="text-xs text-slate-400 hover:text-white">← Back to balances</a>
      </div>

      <LeaveAnalytics fyStartYear={fyStartYear} />
    </div>
  );
}