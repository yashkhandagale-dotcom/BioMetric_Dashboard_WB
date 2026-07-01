'use client';
import { KPIData, Thresholds } from '@/lib/types';
import { DEFAULT_THRESHOLDS } from '@/lib/settings';
import InfoTooltip from './InfoTooltip';

interface KPICardsProps {
  kpi: KPIData;
  thresholds?: Thresholds;
  onCardClick?: (filter: string) => void;
}

type Status = 'green' | 'amber' | 'red';

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
  green: { dot: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-500/5', border: 'border-emerald-500/20' },
  amber: { dot: 'bg-amber-400', text: 'text-amber-400', bg: 'bg-amber-500/5', border: 'border-amber-500/20' },
  red:   { dot: 'bg-red-400', text: 'text-red-400', bg: 'bg-red-500/5', border: 'border-red-500/20' },
};

interface CardDef {
  label: string;
  value: string;
  sub: string;
  status: Status;
  filter: string;
  info: { title: string; description: string; formula?: string; example?: string };
}

export default function KPICards({ kpi, thresholds = DEFAULT_THRESHOLDS, onCardClick }: KPICardsProps) {
  const t = thresholds;
  const cards: CardDef[] = [
    {
      label: 'Attendance Rate',
      value: `${kpi.attendanceRate.toFixed(1)}%`,
      sub: `${kpi.presentCount} present of ${kpi.scheduledCount} scheduled`,
      status: getStatus(kpi.attendanceRate, t.attendanceRateGreen, t.attendanceRateAmber),
      filter: 'present',
      info: {
        title: 'Attendance Rate',
        description: '% of scheduled working days where employees were present (half-day leave counts as 0.5). Weekly offs and holidays excluded from denominator.',
        formula: '(Present ÷ Scheduled) × 100%',
        example: '80 present out of 100 scheduled = 80% attendance rate.',
      },
    },
    {
      label: 'Avg Effective Hours',
      value: `${kpi.avgWorkingHours.toFixed(1)}h`,
      sub: 'Mean hours per present day (excl. Short Days)',
      status: getStatus((kpi.avgWorkingHours / 8) * 100, t.avgHoursPctGreen, t.avgHoursPctAmber),
      filter: 'present',
      info: {
        title: 'Average Effective Hours',
        description: 'Average hours worked per present employee per day. Based on 8 effective hours (9h shift minus 1h lunch). Short Day records excluded.',
        formula: 'Σ(duration) ÷ present days',
        example: '>6h 48m (85% of 8h) = green. <6h (75%) = red.',
      },
    },
    {
      label: 'Late Arrival Rate',
      value: `${kpi.lateArrivalRate.toFixed(1)}%`,
      sub: `${kpi.lateCount} late days of ${kpi.presentCount} present`,
      status: getStatus(kpi.lateArrivalRate, t.lateRateGreen, t.lateRateAmber, true),
      filter: 'late',
      info: {
        title: 'Late Arrival Rate',
        description: `% of present days where in-punch was after 09:30 AM, beyond the ${t.graceMinutes}-minute grace period.`,
        formula: '(Late days ÷ Present days) × 100%',
        example: '10 late out of 80 present = 12.5% late rate (amber).',
      },
    },
    {
      label: 'Early Exit Rate',
      value: `${kpi.earlyExitRate.toFixed(1)}%`,
      sub: `${kpi.earlyExitCount} early exits of ${kpi.presentCount} present`,
      status: getStatus(kpi.earlyExitRate, t.earlyRateGreen, t.earlyRateAmber, true),
      filter: 'earlyexit',
      info: {
        title: 'Early Exit Rate',
        description: `% of present days where out-punch was before 18:30, beyond the ${t.graceMinutes}-minute grace period. >40% signals a structural policy issue, not individual behaviour.`,
        formula: '(Early exits ÷ Present days) × 100%',
        example: '<15% green · 15–40% amber · >40% red.',
      },
    },
    {
      label: 'Productivity Lost',
      value: `${kpi.productivityLost.toFixed(1)}%`,
      sub: 'Capacity lost to late/early',
      status: getStatus(kpi.productivityLost, t.productivityLostGreen, t.productivityLostAmber, true),
      filter: 'present',
      info: {
        title: 'Productivity Lost',
        description: 'Person-capacity lost to late arrivals and early exits. Denominator = present days × 480 effective minutes (8h net shift). Excludes Short Days.',
        formula: 'Σ(late+early mins) ÷ (present days × 480) × 100%',
        example: '30 min late + 15 min early = 45 min lost ÷ 480 = 9.4% for that day.',
      },
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <InfoTooltip
                  title={card.info.title}
                  description={card.info.description}
                  formula={card.info.formula}
                  example={card.info.example}
                  position="bottom"
                />
                <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
              </div>
            </div>
            <p className={`text-2xl font-bold ${c.text} mb-1`}>{card.value}</p>
            <p className="text-slate-500 text-xs">{card.sub}</p>
          </div>
        );
      })}
    </div>
  );
}
