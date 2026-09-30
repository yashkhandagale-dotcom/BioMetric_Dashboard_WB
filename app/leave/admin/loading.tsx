import { LeaveHeaderSkeleton } from '@/components/leave/LeavePageSkeleton';

export default function LeaveAdminLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <LeaveHeaderSkeleton hasActions={true} />

      {/* New joiners banner skeleton */}
      <div className="h-14 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4" />

      {/* Employee cards grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 space-y-4 shadow-sm"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-[var(--bg-elevated)] rounded-full" />
                <div className="space-y-1.5">
                  <div className="h-4 w-28 bg-[var(--bg-elevated)] rounded" />
                  <div className="h-3 w-20 bg-[var(--bg-elevated)]/60 rounded" />
                </div>
              </div>
              <div className="h-6 w-14 bg-[var(--bg-elevated)] rounded-full" />
            </div>
            <div className="grid grid-cols-4 gap-2 pt-2 border-t border-[var(--border-subtle)]">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="text-center space-y-1">
                  <div className="h-2.5 w-8 bg-[var(--bg-elevated)]/60 rounded mx-auto" />
                  <div className="h-5 w-6 bg-[var(--bg-elevated)] rounded mx-auto" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
