// 'use client';
// import { KPIData } from '@/lib/types';

// export default function AbsenceBreakdown({ kpi }: { kpi: KPIData }) {
//   const items = [
//     { label: 'Unexplained', value: kpi.unexplainedAbsentCount, color: 'text-red-400' },
//     { label: 'Planned Leave', value: kpi.plannedLeaveCount, color: 'text-blue-400' },
//     { label: 'Casual Leave', value: kpi.casualLeaveCount, color: 'text-cyan-400' },
//     { label: 'Sick Leave', value: kpi.sickLeaveCount, color: 'text-violet-400' },
//     { label: 'LWP', value: kpi.lwpCount, color: 'text-orange-400' },
//     { label: 'Half Day', value: kpi.halfDayCount, color: 'text-amber-400' },
//   ];

//   return (
//     <></>
//     // <div className="bg-[var(--bg-elevated)]/30 rounded-xl border border-[var(--border)] px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
//     //   <span className="text-[var(--text-muted)] font-medium uppercase tracking-wide">Absences this period:</span>
//     //   {items.map((it, i) => (
//     //     <span key={it.label} className="flex items-center gap-1">
//     //       <span className={`font-semibold ${it.color}`}>{it.value}</span>
//     //       <span className="text-[var(--text-muted)]">{it.label}</span>
//     //       {i < items.length - 1 && <span className="text-[var(--text-muted)] ml-3">·</span>}
//     //     </span>
//     //   ))}
//     // </div>
//   );
// }
