'use client';
import { KPIData, Thresholds, ViewMode } from '@/lib/types';
import { DEFAULT_THRESHOLDS } from '@/lib/settings';
import InfoTooltip from './InfoTooltip';

interface KPICardsProps {
  kpi: KPIData;
  thresholds?: Thresholds;
  viewMode?: ViewMode;
  onCardClick?: (filter: string) => void;
}

type Status = 'green' | 'amber' | 'red' | 'neutral';

function getStatus(value: number, greenThresh: number, amberThresh: number, reverse = false): Status {
  if (!reverse) {
    if (value >= greenThresh) return 'green';
    if (value >= amberThresh) return 'amber';
    return 'red';
  } else {
    if (value < greenThresh) return 'green';
    if (value < amberThresh) return 'amber';
    return 'red';
  }
}

const STATUS_COLORS: Record<Status, { dot: string; text: string; bg: string; border: string }> = {
  green:   { dot: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-500/5',  border: 'border-emerald-500/20' },
  amber:   { dot: 'bg-amber-400',   text: 'text-amber-400',   bg: 'bg-amber-500/5',    border: 'border-amber-500/20' },
  red:     { dot: 'bg-red-400',     text: 'text-red-400',     bg: 'bg-red-500/5',      border: 'border-red-500/20' },
  neutral: { dot: 'bg-slate-500',   text: 'text-slate-300',   bg: 'bg-slate-800/40',   border: 'border-slate-700' },
};

interface CardDef {
  label: string;
  value: string;
  sub: string;
  status: Status;
  filter: string;
  badge?: string;
  info: { title: string; description: string; formula?: string; example?: string };
}

export default function KPICards({ kpi, thresholds = DEFAULT_THRESHOLDS, viewMode = 'monthly', onCardClick }: KPICardsProps) {
  const t = thresholds;
  const isDay = viewMode === 'single_day';

  // SRS §12.6.1: in daily view KPIs show raw headcounts except Avg Hours and Productivity Lost
  const cards: CardDef[] = isDay ? [
    // ── Daily View — raw counts ──────────────────────────────────────────────
    {
      label: 'Present',
      value: `${Math.round(kpi.presentCount)}`,
      sub: `out of ${kpi.scheduledCount} scheduled`,
      badge: `${kpi.scheduledCount > 0 ? ((kpi.presentCount / kpi.scheduledCount) * 100).toFixed(0) : 0}%`,
      status: getStatus(kpi.attendanceRate, t.attendanceRateGreen, t.attendanceRateAmber),
      filter: 'present',
      info: {
        title: 'Present Today',
        description: 'Number of employees who punched in today.',
        formula: 'Count of present employees for the selected date',
        example: '61 out of 82 scheduled',
      },
    },
    {
      label: 'Absent',
      value: `${kpi.absentCount}`,
      sub: `${kpi.unexplainedAbsentCount} unexplained · ${kpi.plannedLeaveCount + kpi.casualLeaveCount + kpi.sickLeaveCount} on leave`,
      status: getStatus(kpi.absenteeismRate, t.absenteeismRateGreen, t.absenteeismRateAmber, true),
      filter: 'absent',
      info: {
        title: 'Absent Today',
        description: 'Employees absent today. Names are clickable in the employee table below.',
        formula: 'Count of absent employees for the selected date',
        example: '21 absent — click the card to filter the table',
      },
    },
    {
      label: 'Late Arrivals',
      value: `${kpi.lateCount}`,
      sub: `punched in after shift start today`,
      status: kpi.lateCount === 0 ? 'green' : kpi.lateCount <= 5 ? 'amber' : 'red',
      filter: 'late',
      info: {
        title: 'Late Arrivals Today',
        description: `Employees who checked in after ${t.graceMinutes}min grace past 09:30 AM today.`,
        formula: 'Count of employees with in-time > shift start + grace period',
        example: '5 late arrivals today',
      },
    },
    {
      label: 'Early Exits',
      value: `${kpi.earlyExitCount}`,
      sub: `${kpi.productivityLostHours.toFixed(1)}h total lost today`,
      status: kpi.earlyExitCount === 0 ? 'green' : getStatus(kpi.earlyExitRate, t.earlyRateGreen, t.earlyRateAmber, true),
      filter: 'earlyexit',
      info: {
        title: 'Early Exits Today',
        description: `Employees who checked out before 18:30 minus grace period today.`,
        formula: 'Count of employees with out-time < shift end − grace period',
        example: '59 early exits — total hours lost shown in subtitle',
      },
    },
    {
      label: 'Avg Working Hours',
      value: `${kpi.avgWorkingHours.toFixed(1)}h`,
      sub: `vs 9h shift duration`,
      status: getStatus((kpi.avgWorkingHours / 9) * 100, t.avgHoursPctGreen, t.avgHoursPctAmber),
      filter: 'present',
      info: {
        title: 'Avg Working Hours Today',
        description: 'Mean of (out-punch − in-punch) for all present employees today.',
        formula: 'Mean duration of present employees today',
        example: '8h 12m avg vs 9h shift',
      },
    },
    {
      label: 'Productivity Lost',
      value: `${kpi.productivityLostHours.toFixed(1)}h`,
      sub: `hours lost today to late/early`,
      status: getStatus((kpi.productivityLostHours / (kpi.presentCount * 9 || 1)) * 100, t.productivityLostGreen, t.productivityLostAmber, true),
      filter: 'present',
      info: {
        title: 'Productivity Lost Today',
        description: 'Sum of late + early-exit minutes for all present employees today, expressed in hours.',
        formula: 'Σ(late_mins + early_mins) ÷ 60',
        example: '4.2 hrs lost across all employees today',
      },
    },
  ] : [
    // ── Monthly / Range View — rates & percentages ───────────────────────────
    {
      label: 'Attendance Rate',
      value: `${kpi.attendanceRate.toFixed(1)}%`,
      sub: `${Math.round(kpi.presentCount)} present of ${kpi.scheduledCount} scheduled`,
      status: getStatus(kpi.attendanceRate, t.attendanceRateGreen, t.attendanceRateAmber),
      filter: 'present',
      info: {
        title: 'Attendance Rate',
        description: '% of scheduled working days where employees were present. Weekly offs and holidays excluded from denominator.',
        formula: '(Present ÷ Scheduled) × 100%',
        example: '80 present out of 100 scheduled = 80%.',
      },
    },
    
    // {
    //   label: 'Absenteeism Rate',
    //   value: `${kpi.absenteeismRate.toFixed(1)}%`,
    //   sub: `${kpi.absentCount} absent of ${kpi.scheduledCount} scheduled`,
    //   status: getStatus(kpi.absenteeismRate, t.absenteeismRateGreen, t.absenteeismRateAmber, true),
    //   filter: 'absent',
    //   info: {
    //     title: 'Absenteeism Rate',
    //     description: '% of scheduled working days where employees were absent. Weekly offs and holidays excluded from denominator.',
    //     formula: '(Absent ÷ Scheduled) × 100%',
    //     example: '10 absent out of 100 scheduled = 10%.',
    //   },
    // },
    {
      label: 'Avg Effective Hours',
      value: `${kpi.avgWorkingHours.toFixed(1)}h`,
      sub: 'Mean hours per present day',
      status: getStatus((kpi.avgWorkingHours / 9) * 100, t.avgHoursPctGreen, t.avgHoursPctAmber),
      filter: 'present',
      info: {
        title: 'Average Effective Hours',
        description: 'Average hours worked per present employee per day. Compared against 9h shift.',
        formula: 'Σ(duration) ÷ present days',
        example: '>7h 39m (85% of 9h) = green.',
      },
    },
    {
      label: 'Late Arrival Rate',
      value: `${kpi.lateArrivalRate.toFixed(1)}%`,
      sub: `${kpi.lateCount} late days of ${Math.round(kpi.presentCount)} present`,
      status: getStatus(kpi.lateArrivalRate, t.lateRateGreen, t.lateRateAmber, true),
      filter: 'late',
      info: {
        title: 'Late Arrival Rate',
        description: `% of present days where in-punch was after 09:30 AM beyond the ${t.graceMinutes}-min grace period.`,
        formula: '(Late days ÷ Present days) × 100%',
        example: '10 late of 80 present = 12.5% (amber).',
      },
    },
    {
      label: 'Early Exit Rate',
      value: `${kpi.earlyExitRate.toFixed(1)}%`,
      sub: `${kpi.earlyExitCount} early exits of ${Math.round(kpi.presentCount)} present`,
      status: getStatus(kpi.earlyExitRate, t.earlyRateGreen, t.earlyRateAmber, true),
      filter: 'earlyexit',
      info: {
        title: 'Early Exit Rate',
        description: `% of present days with out-punch before 18:30 minus grace. >40% signals a structural policy issue.`,
        formula: '(Early exits ÷ Present days) × 100%',
        example: '<15% green · 15–40% amber · >40% red.',
      },
    },
    {
      label: 'Productivity Lost',
      value: `${kpi.productivityLost.toFixed(1)}%`,
      sub: `${kpi.productivityLostHours.toFixed(1)}h capacity lost`,
      status: getStatus(kpi.productivityLost, t.productivityLostGreen, t.productivityLostAmber, true),
      filter: 'present',
      info: {
        title: 'Productivity Lost',
        description: 'Person-capacity lost to late/early. Denominator = present days × 9h shift.',
        formula: 'Σ(late+early mins) ÷ (present days × 540) × 100%',
        example: '30 min late + 15 min early = 45 min lost ÷ 540 = 8.3%.',
      },
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => {
        const c = STATUS_COLORS[card.status];
        return (
          <div
            key={card.label}
            onClick={() => onCardClick?.(card.filter)}
            className={`rounded-xl border p-4 ${c.bg} ${c.border} transition-all relative ${onCardClick ? 'cursor-pointer hover:brightness-110' : ''}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wide leading-tight pr-1">{card.label}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                <InfoTooltip title={card.info.title} description={card.info.description} formula={card.info.formula} example={card.info.example} position="bottom" />
                <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
              </div>
            </div>
            <div className="flex items-end gap-1.5 mb-1">
              <p className={`text-2xl font-bold ${c.text}`}>{card.value}</p>
              {card.badge && (
                <span className="text-xs text-slate-500 font-medium mb-0.5">{card.badge}</span>
              )}
            </div>
            <p className="text-slate-500 text-xs leading-tight">{card.sub}</p>
          </div>
        );
      })}
    </div>
  );
}