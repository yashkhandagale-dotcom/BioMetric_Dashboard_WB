import LeavePageHeader from '@/components/leave/LeavePageHeader';
import { getFYStartYear, formatFYLabel } from '@/lib/leaveSupabase/fyHelpers';

export default async function LeaveAnalyticsPage() {
  const fyStartYear = getFYStartYear();

  return (
    <div className="space-y-6">
      <LeavePageHeader
        title={`Leave Analytics — ${formatFYLabel(fyStartYear)}`}
        description="Comprehensive leave metrics, pattern detection, and capacity planning for HR administration."
      />
    </div>
  );
}
