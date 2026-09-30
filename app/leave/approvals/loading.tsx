import { LeaveHeaderSkeleton } from '@/components/leave/LeavePageSkeleton';

export default function LeaveApprovalsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <LeaveHeaderSkeleton hasActions={false} />

      {/* Filter tabs / pill indicators */}
      <div className="flex gap-2">
        <div className="h-8 w-28 bg-[var(--bg-elevated)] rounded-full" />
        <div className="h-8 w-24 bg-[var(--bg-elevated)] rounded-full" />
        <div className="h-8 w-32 bg-[var(--bg-elevated)] rounded-full" />
      </div>

      {/* Approval request cards skeleton */}
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 space-y-4 shadow-sm"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-[var(--bg-elevated)] rounded-full" />
                <div className="space-y-1">
                  <div className="h-4 w-36 bg-[var(--bg-elevated)] rounded" />
                  <div className="h-3 w-24 bg-[var(--bg-elevated)]/60 rounded" />
                </div>
              </div>
              <div className="flex gap-2">
                <div className="h-9 w-20 bg-[var(--bg-elevated)] rounded-xl" />
                <div className="h-9 w-20 bg-[var(--bg-elevated)] rounded-xl" />
              </div>
            </div>
            <div className="h-12 bg-[var(--bg-elevated)]/30 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
