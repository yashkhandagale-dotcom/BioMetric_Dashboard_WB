import { LeaveCardsSkeleton, LeaveTableSkeleton } from '@/components/leave/LeavePageSkeleton';

export default function LeaveMeLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* MeNavbar / Header skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2">
        <div className="space-y-2">
          <div className="h-7 w-52 bg-[var(--bg-elevated)] rounded-lg" />
          <div className="h-4 w-40 bg-[var(--bg-elevated)]/60 rounded" />
        </div>
        <div className="h-10 w-36 bg-[var(--bg-elevated)] rounded-xl" />
      </div>

      {/* Balance Cards (SL, CL, PL, LWP) */}
      <LeaveCardsSkeleton count={4} cols="grid-cols-2 sm:grid-cols-4" />

      {/* Two-column layout: Attendance on left, WFH on right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 space-y-4 h-64" />
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 space-y-4 h-64" />
      </div>

      {/* Leave History Table */}
      <div className="space-y-3">
        <div className="h-5 w-32 bg-[var(--bg-elevated)] rounded" />
        <LeaveTableSkeleton rows={4} cols={6} />
      </div>
    </div>
  );
}
