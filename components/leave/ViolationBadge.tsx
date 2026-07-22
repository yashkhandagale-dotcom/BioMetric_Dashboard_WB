// D1-4: placeholder only. Real violation detection (notice-shortfall LWP
// conversions, missing medical certificates, probation-period leave taken
// early, negative/over-drawn balances) lands Day 4 behind
// GET /api/leave/violations — see supabase-leave schema comments and the
// Sprint Tracker's D4-1..D4-4 tasks.
//
// This component is wired into EmployeeCard now, with `count` left
// undefined, so Day 4 only has to pass a real count down from the fetched
// violations — no card layout changes needed then.
export default function ViolationBadge({ count }: { count?: number }) {
  if (!count) return null;

  return (
    <span
      title={`${count} open violation${count === 1 ? '' : 's'}`}
      className="shrink-0 bg-red-900/30 border border-red-500/30 text-red-300 text-[10px] font-medium rounded-full px-2 py-0.5"
    >
      {count} violation{count === 1 ? '' : 's'}
    </span>
  );
}