'use client';
import { KPIData, Thresholds, ViewMode } from '@/lib/types';
import { DEFAULT_THRESHOLDS } from '@/lib/settings';
import { targetShiftMinutes } from '@/lib/useDashboardData';
import { minutesToHHMM } from '@/lib/parseCSV';
import InfoTooltip from './InfoTooltip';

interface KPICardsProps {
  kpi: KPIData;
  thresholds?: Thresholds;
  viewMode?: ViewMode;
  onCardClick?: (filter: string) => void;
  activeFilter?: string;
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

function minsToClockStr(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

const STATUS_COLORS: Record<Status, { dot: string; text: string; bg: string; border: string; glow: string }> = {
  green: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-500/5 dark:bg-emerald-500/10',
    border: 'border-emerald-500/25 dark:border-emerald-500/30',
    glow: 'hover:border-emerald-500/50 hover:shadow-emerald-500/10',
  },
  amber: {
    dot: 'bg-amber-500',
    text: 'text-amber-800 dark:text-amber-300',
    bg: 'bg-amber-500/5 dark:bg-amber-500/10',
    border: 'border-amber-500/25 dark:border-amber-500/30',
    glow: 'hover:border-amber-500/50 hover:shadow-amber-500/10',
  },
  red: {
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-500/5 dark:bg-red-500/10',
    border: 'border-red-500/25 dark:border-red-500/30',
    glow: 'hover:border-red-500/50 hover:shadow-red-500/10',
  },
  neutral: {
    dot: 'bg-[var(--text-muted)]',
    text: 'text-[var(--text-primary)]',
    bg: 'bg-[var(--bg-elevated)]/40',
    border: 'border-[var(--border)]',
    glow: 'hover:border-[var(--accent)]/50',
  },
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

export default function KPICards({ kpi, thresholds = DEFAULT_THRESHOLDS, viewMode = 'monthly', onCardClick, activeFilter }: KPICardsProps) {
  const t = thresholds;
  const isDay = viewMode === 'single_day';

  const targetMinutes = targetShiftMinutes(t.shiftStartMinutes, t.shiftEndMinutes);
  const targetHours = targetMinutes / 60;
  const shiftStartStr = minsToClockStr(t.shiftStartMinutes);
  const shiftEndStr = minsToClockStr(t.shiftEndMinutes);

  const cards: CardDef[] = isDay ? [
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
      label: 'On Leave',
      value: `${kpi.absentCount}`,
      sub: `${kpi.unexplainedAbsentCount} unmarked · ${kpi.plannedLeaveCount + kpi.casualLeaveCount + kpi.sickLeaveCount} marked`,
      status: getStatus(kpi.absenteeismRate, t.absenteeismRateGreen, t.absenteeismRateAmber, true),
      filter: 'absent',
      info: {
        title: 'On Leave Today',
        description: 'Employees not present today — shown as marked (HR has recorded a leave type for that day) or unmarked (no leave recorded yet). Names are clickable in the employee table below.',
        formula: 'Count of employees not present for the selected date',
        example: '21 on leave — click the card to filter the table',
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
        description: `Employees who checked in after ${t.graceMinutes}min grace past ${shiftStartStr} today.`,
        formula: 'Count of employees with in-time > shift start + grace period',
        example: '5 late arrivals today',
      },
    },
    {
      label: 'Early Exits',
      value: `${kpi.earlyExitCount}`,
      sub: `${minutesToHHMM(Math.round(kpi.productivityLostHours * 60))} total lost today`,
      status: kpi.earlyExitCount === 0 ? 'green' : getStatus(kpi.earlyExitRate, t.earlyRateGreen, t.earlyRateAmber, true),
      filter: 'earlyexit',
      info: {
        title: 'Early Exits Today',
        description: `Employees who checked out before ${shiftEndStr} minus grace period today.`,
        formula: 'Count of employees with out-time < shift end − grace period',
        example: '59 early exits — total hours lost shown in subtitle',
      },
    },
    {
      label: 'Avg Effective Hours',
      value: minutesToHHMM(Math.round(kpi.avgWorkingHours * 60)),
      sub: `vs ${minutesToHHMM(targetMinutes)} effective shift target`,
      status: getStatus((kpi.avgWorkingHours / targetHours) * 100, t.avgHoursPctGreen, t.avgHoursPctAmber),
      filter: 'present',
      info: {
        title: 'Avg Effective Hours Today',
        description: `Mean of (duration − 1h lunch) for all present employees today, compared against the ${minutesToHHMM(targetMinutes)} effective target (shift span minus 1h lunch).`,
        formula: 'Mean of (duration − 60 min lunch) for present employees today',
        example: `8:12 avg vs ${minutesToHHMM(targetMinutes)} target`,
      },
    },
    {
      label: 'Productivity Lost',
      value: minutesToHHMM(Math.round(kpi.productivityLostHours * 60)),
      sub: `hours lost today to late/early`,
      status: getStatus((kpi.productivityLostHours / (kpi.presentCount * targetHours || 1)) * 100, t.productivityLostGreen, t.productivityLostAmber, true),
      filter: 'present',
      info: {
        title: 'Productivity Lost Today',
        description: 'Sum of late + early-exit minutes for all present employees today, expressed in hours.',
        formula: 'Σ(late_mins + early_mins) ÷ 60',
        example: '4.2 hrs lost across all employees today',
      },
    },
  ] : [
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
    {
      label: 'Avg Effective Hours',
      value: minutesToHHMM(Math.round(kpi.avgWorkingHours * 60)),
      sub: 'Mean hours per present day',
      status: getStatus((kpi.avgWorkingHours / targetHours) * 100, t.avgHoursPctGreen, t.avgHoursPctAmber),
      filter: 'present',
      info: {
        title: 'Average Effective Hours',
        description: `Average hours worked per present employee per day. Compared against the ${minutesToHHMM(targetMinutes)} effective shift target (shift span minus 1h lunch).`,
        formula: 'Σ(duration) ÷ present days',
        example: `>${minutesToHHMM(Math.round(targetMinutes * 0.85))} (85% of ${minutesToHHMM(targetMinutes)}) = green.`,
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
        description: `% of present days where in-punch was after ${shiftStartStr} beyond the ${t.graceMinutes}-min grace period.`,
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
        description: `% of present days with out-punch before ${shiftEndStr} minus grace. >40% signals a structural policy issue.`,
        formula: '(Early exits ÷ Present days) × 100%',
        example: '<15% green · 15–40% amber · >40% red.',
      },
    },
    {
      label: 'Productivity Lost',
      value: `${kpi.productivityLost.toFixed(1)}%`,
      sub: `${minutesToHHMM(Math.round(kpi.productivityLostHours * 60))} capacity lost`,
      status: getStatus(kpi.productivityLost, t.productivityLostGreen, t.productivityLostAmber, true),
      filter: 'present',
      info: {
        title: 'Productivity Lost',
        description: `Person-capacity lost to late/early. Denominator = present days × ${minutesToHHMM(targetMinutes)} effective shift target.`,
        formula: `Σ(late+early mins) ÷ (present days × ${targetMinutes}) × 100%`,
        example: '30 min late + 15 min early = 45 min lost ÷ 540 = 8.3%.',
      },
    },
    {
      label: 'Short Days',
      value: `${kpi.shortDayCount}`,
      sub: `days with < 4h worked`,
      status: kpi.shortDayCount === 0 ? 'green' : kpi.shortDayCount <= 5 ? 'amber' : 'red',
      filter: 'shortday',
      info: {
        title: 'Short Days',
        description: 'Working days where employee completed less than the minimum short day duration threshold.',
        formula: 'Count of days with total working minutes < short day threshold',
        example: 'Click card to see employees with short days',
      },
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => {
        const c = STATUS_COLORS[card.status];
        const isSelected = activeFilter === card.filter;

        return (
          <div
            key={card.label}
            onClick={() => onCardClick?.(card.filter)}
            className={`rounded-2xl border p-4 ${c.bg} ${c.border} ${c.glow} transition-all duration-200 relative shadow-sm hover:shadow-md ${
              onCardClick ? 'cursor-pointer hover:-translate-y-0.5' : ''
            } ${isSelected ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] shadow-md' : ''}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[var(--text-muted)] text-[11px] font-semibold uppercase tracking-wider leading-tight pr-1 truncate">
                {card.label}
              </span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <InfoTooltip title={card.info.title} description={card.info.description} formula={card.info.formula} example={card.info.example} position="bottom" />
                <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${c.dot} shadow-sm`} />
              </div>
            </div>
            <div className="flex items-baseline gap-1.5 mb-1.5">
              <p className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${c.text}`}>{card.value}</p>
              {card.badge && (
                <span className="text-xs font-semibold text-[var(--text-muted)] bg-[var(--bg-elevated)]/60 px-1.5 py-0.5 rounded-md border border-[var(--border)]">
                  {card.badge}
                </span>
              )}
            </div>
            <p className="text-[var(--text-muted)] text-xs leading-snug line-clamp-2">{card.sub}</p>
          </div>
        );
      })}
    </div>
  );
}