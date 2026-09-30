export function LeaveHeaderSkeleton({ hasActions = false }: { hasActions?: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-[var(--border)] animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-48 bg-[var(--bg-elevated)] rounded-lg" />
        <div className="h-4 w-72 bg-[var(--bg-elevated)]/60 rounded" />
      </div>
      {hasActions && (
        <div className="flex items-center gap-2">
          <div className="h-9 w-28 bg-[var(--bg-elevated)] rounded-lg" />
          <div className="h-9 w-28 bg-[var(--bg-elevated)] rounded-lg" />
        </div>
      )}
    </div>
  );
}

export function LeaveCardsSkeleton({ count = 4, cols = 'grid-cols-2 sm:grid-cols-4' }: { count?: number; cols?: string }) {
  return (
    <div className={`grid gap-4 ${cols} animate-pulse`}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="h-3 w-16 bg-[var(--bg-elevated)] rounded" />
            <div className="h-2 w-2 bg-[var(--bg-elevated)] rounded-full" />
          </div>
          <div className="h-7 w-12 bg-[var(--bg-elevated)] rounded-lg" />
          <div className="h-2 w-full bg-[var(--bg-elevated)]/40 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function LeaveTableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm animate-pulse">
      <div className="border-b border-[var(--border)] px-4 py-3 flex gap-6 bg-[var(--bg-surface)]/60">
        {Array.from({ length: cols }).map((_, i) => (
          <div
            key={i}
            className="h-3.5 bg-[var(--bg-elevated)] rounded"
            style={{ width: i === 0 ? '7rem' : '4.5rem' }}
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="px-4 py-3.5 flex items-center gap-6 border-b border-[var(--border-subtle)] last:border-0"
        >
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-3 bg-[var(--bg-elevated)]/60 rounded"
              style={{
                width: c === 0 ? '10rem' : c === 1 ? '5rem' : '4rem',
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
