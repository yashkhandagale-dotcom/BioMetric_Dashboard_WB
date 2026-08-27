export default function AttendanceTableSkeleton({
  columns,
  rows = 6,
}: {
  columns: number;
  rows?: number;
}) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
      <div className="border-b border-[var(--border)] px-4 py-3 flex gap-6 bg-[var(--bg-surface)]/60">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="h-3.5 bg-[var(--bg-elevated)] rounded-md animate-pulse" style={{ width: i === 0 ? '7rem' : '4.5rem' }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="px-4 py-3.5 flex items-center gap-6 border-b border-[var(--border-subtle)] last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <div
              key={c}
              className="h-3 bg-[var(--bg-elevated)]/60 rounded-md animate-pulse"
              style={{
                width: c === 0 ? '10rem' : c === 1 ? '5rem' : '4rem',
                animationDelay: `${(r * 50) + (c * 20)}ms`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
