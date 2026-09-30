import { LeaveHeaderSkeleton } from '@/components/leave/LeavePageSkeleton';

export default function LeaveAttendanceLoading() {
  return (
    <div className="max-w-3xl space-y-8 animate-pulse">
      <LeaveHeaderSkeleton hasActions={false} />

      {/* Info banner skeleton */}
      <div className="h-16 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl" />

      {/* Attendance exceptions skeleton */}
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 space-y-3 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="h-4 w-32 bg-[var(--bg-elevated)] rounded" />
              <div className="h-6 w-20 bg-[var(--bg-elevated)] rounded-full" />
            </div>
            <div className="h-10 bg-[var(--bg-elevated)]/40 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
