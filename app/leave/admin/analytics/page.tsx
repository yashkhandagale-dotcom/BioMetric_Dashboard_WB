import LeavePageHeader from '@/components/leave/LeavePageHeader';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';
import LeaveAnalyticsDashboard from '@/components/leave/analytics/LeaveAnalyticsDashboard';

export default async function LeaveAnalyticsPage() {
  const fyStartYear = getFYStartYear();

  return (
    <div className="space-y-6">
      <LeavePageHeader
        title={`Leave Analytics — ${formatFYLabel(fyStartYear)}`}
        description="Strategic workforce leave intelligence, attachment pattern detection, and capacity planning for HR leadership."
      />
      <LeaveAnalyticsDashboard initialFyStartYear={fyStartYear} />
    </div>
  );
}
