'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend,
} from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { DailyTrend, AttendanceRecord, Holiday } from '@/lib/types';
import { isPresent, isWeeklyOff } from '@/lib/useDashboardData';
import { isHoliday } from '@/lib/holidays';
import InfoTooltip from '../InfoTooltip';
import { useTrendChartLayout, useGranularityOverride } from '@/lib/chartLayout';
import { useThemeColors } from '@/lib/useThemeColors';
import { rateColor, COMPARISON_LINE_COLORS } from './chartUtils';
import { ChartSubtitle, GranularityToggle } from './ChartShared';

// ── Daily Attendance Trend ────────────────────────────────────────────────────
export function DailyTrendChart({ data, selectedDepts, onDateClick, selectedDate }: {
  data: DailyTrend[];
  selectedDepts?: string[];
  onDateClick?: (date: string) => void;
  selectedDate?: string | null;
}) {
  const __tc = useThemeColors();
  const [absentModal, setAbsentModal] = useState<{ date: string; names: string[] } | null>(null);

  const lastClickRef = useRef<{ date: string; time: number } | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current); };
  }, []);

  const { override: granularityOverride, setOverride: setGranularityOverride } = useGranularityOverride();
  const { data: chartData, granularity, minWidth, isAggregated } = useTrendChartLayout(data, {
    averageKeys: ['attendanceRate'],
    sumKeys: ['presentCount', 'totalCount', 'lateCount', 'earlyExitCount', 'shortDayCount'],
    forceGranularity: granularityOverride,
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const entry = payload[0]?.payload;
    const rate = entry?.attendanceRate ?? 0;
    const present = entry?.presentCount ?? 0;
    const total = entry?.totalCount ?? 0;
    const absentees: string[] = entry?.absentees ?? [];
    const shown = absentees.slice(0, 5);
    const extra = absentees.length - 5;
    return (
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-xl max-w-[240px]">
        <p className="text-[var(--text-muted)] font-medium mb-1">{label}</p>
        <p style={{ color: rateColor(rate) }}>Rate: <strong>{rate}%</strong></p>
        <p className="text-blue-400">Present: {present} / {total}</p>
        {entry?.lateCount > 0 && <p className="text-amber-400">Late: {entry.lateCount}</p>}
        {entry?.shortDayCount > 0 && <p className="text-orange-400">Short Days: {entry.shortDayCount}</p>}
        {absentees.length > 0 && (
          <>
            <div className="border-t border-[var(--border)] my-1.5" />
            <p className="text-red-400 mb-1">Absent ({absentees.length}):</p>
            {shown.map((n, i) => <p key={i} className="text-[var(--text-muted)] truncate">{n}</p>)}
            {extra > 0 && <p className="text-[var(--text-muted)] text-[10px] mt-1">+{extra} more — double-click the point to see all</p>}
          </>
        )}
      </div>
    );
  };

  function handleChartClick(e: any) {
    if (isAggregated) return;
    const index = Number(e?.activeTooltipIndex);
    if (Number.isNaN(index) || index < 0 || index >= chartData.length) return;
    const payload = chartData[index];
    const rawDate = payload.rawDate ?? payload.date;
    const absentees = payload.absentees ?? [];
    const now = Date.now();
    const isDoubleClick = !!lastClickRef.current && lastClickRef.current.date === rawDate && now - lastClickRef.current.time < 400;
    if (isDoubleClick) {
      if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
      lastClickRef.current = null;
      if (absentees.length) setAbsentModal({ date: payload.date, names: absentees });
      return;
    }
    lastClickRef.current = { date: rawDate, time: now };
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      onDateClick?.(rawDate);
      clickTimerRef.current = null;
      lastClickRef.current = null;
    }, 400);
  }

  return (
    <>
      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[280px]">
        <div className="flex items-start justify-between mb-1 flex-wrap gap-2">
          <div>
            <h3 className="text-[var(--text-primary)] font-semibold text-sm">Daily Attendance Trend</h3>
            <ChartSubtitle selectedDepts={selectedDepts} />
          </div>
          <div className="flex items-center gap-2">
            <GranularityToggle value={granularityOverride} onChange={setGranularityOverride} active={granularity} />
            <InfoTooltip title="Daily Attendance Trend" description="Daily attendance rate = present employees ÷ scheduled employees for that day. Holidays excluded. Past ~45 days the chart auto-switches to weekly averages, and past ~6 months to monthly, so it stays readable at any range — use the toggle to override. Double-click a date point to see the full absentee list for that day (daily view only)." formula="Present ÷ (Scheduled - WeeklyOff - Holidays) × 100" />
          </div>
        </div>
        {chartData.length === 0
          ? <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">No data</div>
          : (
            <>
              {selectedDate && (
                <p className="text-blue-400 text-xs mb-2 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                  Showing: {selectedDate.slice(5)} · click another point to switch, click same to clear
                </p>
              )}
              <p className="text-[var(--text-muted)] text-[10px] mb-1">
                {isAggregated
                  ? `Showing ${granularity} averages across ${data.length} days · switch to Daily to drill into a single day`
                  : 'Hover a point to see absentees · double-click to see the full absentee list'}
              </p>
              <div className="overflow-x-auto">
                <div style={{ minWidth }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart
                      data={chartData}
                      margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
                      onClick={handleChartClick}
                      style={{ cursor: onDateClick && !isAggregated ? 'pointer' : 'default' }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: __tc.mutedText }} interval="preserveStart" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: __tc.mutedText }} unit="%" />
                      <ReferenceLine y={80} stroke="#34d399" strokeDasharray="4 2" strokeOpacity={0.6} />
                      <ReferenceLine y={70} stroke="#fbbf24" strokeDasharray="4 2" strokeOpacity={0.6} />
                      {selectedDate && !isAggregated && (
                        <ReferenceLine x={selectedDate.slice(5)} stroke="#60a5fa" strokeWidth={2} strokeDasharray="4 2" label={{ value: '▼', fill: '#60a5fa', fontSize: 10 }} />
                      )}
                      <Tooltip
                        content={<CustomTooltip />}
                        wrapperStyle={{ pointerEvents: 'auto', zIndex: 50 }}
                      />
                      <Line
                        type="monotone" dataKey="attendanceRate" name="Attendance %" stroke="#60a5fa" strokeWidth={2}
                        dot={(props: any) => {
                          const rate = props.payload.attendanceRate;
                          const isSelected = !isAggregated && selectedDate && props.payload.rawDate === selectedDate;
                          const color = rateColor(rate);
                          return <circle key={props.index} cx={props.cx} cy={props.cy}
                            r={isSelected ? 5 : 3} fill={color} stroke={isSelected ? '#fff' : 'none'} strokeWidth={isSelected ? 2 : 0} />;
                        }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
      </div>

      {absentModal && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setAbsentModal(null)}
        >
          <div
            className="scroll-thin bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl p-5 max-w-md w-full max-h-[80vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold text-sm">Absent on {absentModal.date}</h3>
                <p className="text-[var(--text-muted)] text-xs mt-0.5">{absentModal.names.length} employees absent</p>
              </div>
              <button
                onClick={() => setAbsentModal(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg leading-none transition-colors"
              >✕</button>
            </div>
            <div className="space-y-0.5">
              {[...absentModal.names].sort().map((name, i) => (
                <div key={i} className="flex items-center gap-2 py-2 border-b border-[var(--border)]/40 last:border-0">
                  <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                  <span className="text-[var(--text-muted)] text-sm">{name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Multi-Department Daily Trend (comparison mode) ───────────────────────────
export function ComparisonTrendChart({ records, selectedDepts, holidays = [], graceMinutes = 10 }: {
  records: AttendanceRecord[];
  selectedDepts: string[];
  holidays?: Holiday[];
  graceMinutes?: number;
}) {
  const __tc = useThemeColors();
  const depts = selectedDepts.slice(0, 5);

  const { dailyRows, dates } = useMemo(() => {
    const byDate = new Map<string, Map<string, { present: number; total: number }>>();
    for (const r of records) {
      if (!depts.includes(r.department)) continue;
      if (isWeeklyOff(r.status)) continue;
      if (isHoliday(r.date, holidays) && !isPresent(r.status)) continue;
      if (!byDate.has(r.date)) byDate.set(r.date, new Map());
      const deptMap = byDate.get(r.date)!;
      if (!deptMap.has(r.department)) deptMap.set(r.department, { present: 0, total: 0 });
      const d = deptMap.get(r.department)!;
      if (!r.isShortDay) d.total++;
      if (isPresent(r.status) && !r.isShortDay) d.present++;
    }
    const sortedDates = Array.from(byDate.keys()).sort();
    const data = sortedDates.map(date => {
      const deptMap = byDate.get(date)!;
      const row: Record<string, string | number> = { date: date.slice(5), rawDate: date };
      for (const dept of depts) {
        const d = deptMap.get(dept);
        row[dept] = d && d.total > 0 ? Math.round((d.present / d.total) * 100) : 0;
      }
      return row;
    });
    return { dailyRows: data, dates: sortedDates };
  }, [records, depts, holidays]);

  const { override: granularityOverride, setOverride: setGranularityOverride } = useGranularityOverride();
  const { data: chartData, granularity, minWidth, isAggregated } = useTrendChartLayout(dailyRows as any[], {
    averageKeys: depts,
    forceGranularity: granularityOverride,
  });

  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[280px]">
      <div className="flex items-start justify-between mb-1 flex-wrap gap-2">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Daily Attendance Trend — Comparison</h3>
          <p className="text-[var(--text-muted)] text-xs mt-0.5 mb-3">
            {depts.length < selectedDepts.length
              ? `Showing first ${depts.length} of ${selectedDepts.length} selected departments`
              : 'One line per selected department'}
            {isAggregated ? ` · ${granularity} averages across ${dailyRows.length} days` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GranularityToggle value={granularityOverride} onChange={setGranularityOverride} active={granularity} />
          <InfoTooltip title="Daily Attendance Trend — Comparison" description="Daily attendance rate per department, so you can compare trends side by side. Holidays excluded. Past ~45 days this auto-switches to weekly averages, and past ~6 months to monthly, so it stays readable regardless of how many months are selected." formula="Present ÷ (Scheduled - WeeklyOff - Holidays) × 100, per department" />
        </div>
      </div>
      {chartData.length === 0 || dates.length === 0
        ? <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">No data</div>
        : (
          <div className="overflow-x-auto">
            <div style={{ minWidth }}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: __tc.mutedText }} interval="preserveStart" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: __tc.mutedText }} unit="%" />
                  <Tooltip
                    content={({ active, payload, label }: any) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs shadow-xl">
                          <p className="text-[var(--text-muted)] font-medium mb-1">{label}</p>
                          {payload.map((p: any) => (
                            <p key={p.dataKey} style={{ color: p.color }}>{p.dataKey}: <strong>{p.value}%</strong></p>
                          ))}
                        </div>
                      );
                    }}
                    wrapperStyle={{ pointerEvents: 'none', zIndex: 50 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={(v: string) => <span style={{ color: __tc.mutedText }}>{v}</span>} />
                  {depts.map((dept, i) => (
                    <Line key={dept} type="monotone" dataKey={dept} name={dept}
                      stroke={COMPARISON_LINE_COLORS[i % COMPARISON_LINE_COLORS.length]}
                      strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
    </div>
  );
}
