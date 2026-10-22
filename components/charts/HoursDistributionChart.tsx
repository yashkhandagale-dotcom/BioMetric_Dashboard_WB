'use client';
import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { HoursDistribution, AttendanceRecord } from '@/lib/types';
import { isPresent } from '@/lib/useDashboardData';
import { durationToMinutes, minutesToHHMM } from '@/lib/parseCSV';
import { effectiveMinutes } from '@/lib/hoursCalc';
import InfoTooltip from '../InfoTooltip';
import { useThemeColors } from '@/lib/useThemeColors';
import { ChartSubtitle } from './ChartShared';

// ── Hours Distribution (bins by 30-min intervals, drill to employees) ─────────
export function HoursDistributionChart({ data, allRecords, selectedDepts }: {
  data: HoursDistribution[];
  allRecords: AttendanceRecord[];
  selectedDepts?: string[];
}) {
  const __tc = useThemeColors();
  const [drillBin, setDrillBin] = useState<string | null>(null);

  // Aggregate to one avg-hours number PER EMPLOYEE first — every employee
  // falls into exactly one bar, and this same aggregation feeds both the
  // chart and the drill-down so the two can never disagree.
  const employeeAverages = useMemo(() => {
    const map = new Map<string, { name: string; code: string; dept: string; effectiveMins: number; days: number }>();
    for (const r of allRecords) {
      if (!isPresent(r.status) || r.isShortDay) continue;
      const raw = durationToMinutes(r.duration);
      const effective = effectiveMinutes(raw);
      if (effective === null) continue;
      if (effective <= 0 || effective > 720) continue;
      if (!map.has(r.employeeCode)) {
        map.set(r.employeeCode, { name: r.employeeName || r.employeeCode, code: r.employeeCode, dept: r.department || 'Unknown', effectiveMins: 0, days: 0 });
      }
      const e = map.get(r.employeeCode)!;
      e.effectiveMins += effective;
      e.days++;
    }
    return Array.from(map.values())
      .filter(e => e.days > 0)
      .map(e => ({ ...e, avgMins: e.effectiveMins / e.days, avgHours: +(e.effectiveMins / e.days / 60).toFixed(2) }));
  }, [allRecords]);

  const bins = useMemo(() => {
    const binMap = new Map<string, number>();
    for (let h = 0; h <= 12; h++) {
      for (const m of [0, 30]) {
        const label = `${h}:${m === 0 ? '00' : m}`;
        binMap.set(label, 0);
      }
    }
    for (const e of employeeAverages) {
      const binH = Math.floor(e.avgMins / 30) * 30;
      const label = `${Math.floor(binH / 60)}:${binH % 60 === 0 ? '00' : '30'}`;
      binMap.set(label, (binMap.get(label) || 0) + 1);
    }
    return Array.from(binMap.entries())
      .map(([bin, count]) => ({ bin, count }))
      .filter(b => b.count > 0);
  }, [employeeAverages]);

  const drillEmployees = useMemo(() => {
    if (!drillBin) return [];
    const [hStr, mStr] = drillBin.split(':');
    const binStart = parseInt(hStr) * 60 + parseInt(mStr);
    const binEnd = binStart + 30;
    return employeeAverages
      .filter(e => e.avgMins >= binStart && e.avgMins < binEnd)
      .sort((a, b) => a.avgHours - b.avgHours);
  }, [drillBin, employeeAverages]);

  if (drillBin) {
    return (
      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[280px]">
        <div className="flex items-center flex-wrap gap-3 mb-1">
          <button onClick={() => setDrillBin(null)} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-xs font-medium transition-colors shrink-0">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <h3 className="text-white font-semibold text-sm">Employees: {drillBin}–{drillBin.split(':')[0]}:{ parseInt(drillBin.split(':')[1]) === 0 ? '30' : '00'} avg effective work</h3>
        </div>
        <p className="text-[var(--text-muted)] text-xs mb-4">{drillEmployees.length} employees average in this range</p>
        {drillEmployees.length === 0
          ? <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">No data</div>
          : (
            <div className="scroll-thin space-y-1 max-h-80 overflow-y-auto">
              {drillEmployees.map((e, i) => (
                <div key={e.code} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--bg-elevated)]/30 hover:bg-[var(--bg-elevated)]/50">
                  <div>
                    <span className="text-[var(--text-primary)] text-xs font-medium">{e.name}</span>
                    <span className="text-[var(--text-muted)] text-xs ml-2">· {e.dept}</span>
                  </div>
                  <span className="text-blue-400 text-xs font-mono">{minutesToHHMM(Math.round(e.avgMins))} avg</span>
                </div>
              ))}
            </div>
          )}
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] p-4 min-h-[280px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Working Hours Distribution</h3>
          <ChartSubtitle selectedDepts={selectedDepts} />
        </div>
        <InfoTooltip title="Hours Distribution" description="Each employee's own average working hours (total duration − 1h lunch, averaged across their present days in the selected period) — every employee falls into exactly one bar. Click a bar to see which employees fall in that range." formula="Working hours = Duration − 60 min lunch, averaged per employee · Bin = 30 minutes" />
      </div>
      {bins.length === 0
        ? <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">No data</div>
        : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={bins} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={__tc.border} />
              <XAxis dataKey="bin" tick={{ fontSize: 10, fill: __tc.mutedText }} interval={1} />
              <YAxis tick={{ fontSize: 10, fill: __tc.mutedText }} allowDecimals={false} />
              <ReferenceLine x="8:00" stroke={__tc.mutedText} strokeDasharray="4 2" />
              <Tooltip content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                    <p className="text-slate-300 font-medium">{label} avg effective range</p>
                    <p className="text-blue-400">Count: <strong>{payload[0]?.value} employees</strong></p>
                    <p className="text-[var(--text-muted)] text-[10px] mt-1">Click to see employees</p>
                  </div>
                );
              }} />
              <Bar dataKey="count" fill="#60a5fa" radius={[3, 3, 0, 0]} cursor="pointer"
                onClick={(entry: any) => setDrillBin(entry.bin)}>
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}
