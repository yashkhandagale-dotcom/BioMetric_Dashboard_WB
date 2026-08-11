import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import LeaveAnalytics from '@/components/leave/LeaveAnalytics';
import LeavePageHeader from '@/components/leave/LeavePageHeader';

// Was previously always rendered inline at the bottom of /leave/admin —
// moved to its own route behind a sidebar tab so the main balances/
// employees page stays focused and doesn't run analytics queries on
// every load of the primary admin screen.
export default async function LeaveAnalyticsPage() {
  const fyStartYear = getFYStartYear();

  return (
    <div className="space-y-6">
      <LeavePageHeader title={`Leave Analytics — ${formatFYLabel(fyStartYear)}`} />
      <LeaveAnalytics fyStartYear={fyStartYear} />
    </div>
  );
}
