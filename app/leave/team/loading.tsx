import { LeaveHeaderSkeleton, LeaveCardsSkeleton, LeaveTableSkeleton } from '@/components/leave/LeavePageSkeleton';

export default function LeaveTeamLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <LeaveHeaderSkeleton hasActions={false} />

      {/* Tabs bar skeleton */}
      <div className="flex gap-2 border-b border-[var(--border)] pb-2">
        <div className="h-9 w-36 bg-[var(--bg-elevated)] rounded-lg" />
        <div className="h-9 w-36 bg-[var(--bg-elevated)] rounded-lg" />
        <div className="h-9 w-36 bg-[var(--bg-elevated)] rounded-lg" />
        <div className="h-9 w-36 bg-[var(--bg-elevated)] rounded-lg" />
      </div>

      {/* Quick summary stats */}
      <LeaveCardsSkeleton count={3} cols="grid-cols-1 sm:grid-cols-3" />

      {/* Team roster / history table */}
      <LeaveTableSkeleton rows={6} cols={6} />
    </div>
  );
}
