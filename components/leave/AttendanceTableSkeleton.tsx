// Shared skeleton for AbsenteesPanel / HalfDayPanel while a date (or date
// range) request is in flight. Renders the same table chrome (header +
// N placeholder rows) so the layout doesn't jump between loading and
// loaded states, and reads as "content coming" rather than a blank
// "Loading…" line.
export default function AttendanceTableSkeleton({
  columns,
  rows = 6,
}: {
  columns: number;
  rows?: number;
}) {
  return (
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl overflow-hidden animate-pulse">
      <div className="border-b border-[var(--border)] px-4 py-2 flex gap-6">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="h-3 bg-[var(--bg-elevated)]/60 rounded w-16" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="px-4 py-3 flex items-center gap-6 border-b border-[var(--border)] last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <div
              key={c}
              className="h-3 bg-[var(--bg-elevated)]/40 rounded"
              style={{ width: c === 0 ? '9rem' : '5rem' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
