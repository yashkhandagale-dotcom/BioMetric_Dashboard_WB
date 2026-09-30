import { LeaveHeaderSkeleton, LeaveCardsSkeleton, LeaveTableSkeleton } from '@/components/leave/LeavePageSkeleton';

export default function LeaveRootLoading() {
  return (
    <div className="space-y-6">
      <LeaveHeaderSkeleton hasActions={false} />
      <LeaveCardsSkeleton count={4} />
      <LeaveTableSkeleton rows={5} cols={5} />
    </div>
  );
}
