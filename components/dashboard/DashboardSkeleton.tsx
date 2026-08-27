'use client';

export default function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Top Filter Bar Skeleton */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-9 w-64 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg" />
        <div className="flex gap-1.5">
          <div className="h-9 w-16 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg" />
          <div className="h-9 w-16 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg" />
        </div>
        <div className="flex gap-1.5">
          <div className="h-8 w-20 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg" />
          <div className="h-8 w-24 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg" />
          <div className="h-8 w-20 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg" />
        </div>
      </div>

      {/* KPI Cards Skeleton (6 cards) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/40 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-16 bg-[var(--border)] rounded" />
              <div className="h-2.5 w-2.5 bg-[var(--border)] rounded-full" />
            </div>
            <div className="h-7 w-20 bg-[var(--border)] rounded" />
            <div className="h-3 w-28 bg-[var(--border)]/70 rounded" />
          </div>
        ))}
      </div>

      {/* Charts Skeleton Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/30 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-4 w-40 bg-[var(--border)] rounded" />
            <div className="h-6 w-24 bg-[var(--border)] rounded-lg" />
          </div>
          <div className="h-64 bg-[var(--bg-elevated)]/60 rounded-xl" />
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/30 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-4 w-44 bg-[var(--border)] rounded" />
            <div className="h-6 w-24 bg-[var(--border)] rounded-lg" />
          </div>
          <div className="h-64 bg-[var(--bg-elevated)]/60 rounded-xl" />
        </div>
      </div>

      {/* Table Skeleton */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/30 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-4 w-36 bg-[var(--border)] rounded" />
          <div className="h-8 w-48 bg-[var(--border)] rounded-lg" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 bg-[var(--bg-elevated)]/50 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
