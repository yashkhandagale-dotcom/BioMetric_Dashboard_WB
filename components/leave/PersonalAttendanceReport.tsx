'use client';

import { useEffect, useState } from 'react';
import { currentMonthKey, monthLabel, shiftMonthKey } from '@/lib/leaveCalendar';
import type { EmployeeAttendanceKPIs } from '@/lib/leaveSupabase/getEmployeeAttendanceKPIs';

// A2 — renders the shared attendance-KPI extraction (A1:
// lib/leaveSupabase/getEmployeeAttendanceKPIs.ts, which wraps the same
// computeEmployeeKPIs() the main dashboard's EmployeeModal/EmployeeTable
// use) for one employee, with a month selector. Wherever this panel
// shows hours, both "Actual" and "Effective" are shown, clearly
// labeled — per the labeling convention, never an unlabeled single
// hours number (lib/hoursCalc.ts).
export default function PersonalAttendanceReport() {
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [kpis, setKpis] = useState<EmployeeAttendanceKPIs | null>(null);
  const [recordCount, setRecordCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/leave/me/attendance?month=${monthKey}`);
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) {
          if (!cancelled) setError(data.error || `Could not load attendance (${res.status}).`);
          return;
        }
        if (!cancelled) {
          setKpis(data.kpis);
          setRecordCount(data.recordCount ?? 0);
        }
      } catch {
        if (!cancelled) setError('Could not reach the server to load attendance.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [monthKey]);

  return (
    <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">My Attendance</h2>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMonthKey((m) => shiftMonthKey(m, -1))}
            className="px-2 py-1 rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            ←
          </button>
          <span className="text-[var(--text-primary)] font-medium min-w-[110px] text-center">{monthLabel(monthKey)}</span>
          <button
            type="button"
            onClick={() => setMonthKey((m) => shiftMonthKey(m, 1))}
            disabled={monthKey >= currentMonthKey()}
            className="px-2 py-1 rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            →
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-[var(--bg-elevated)]/50 animate-pulse" />
          ))}
        </div>
      ) : !kpis || recordCount === 0 ? (
        <p className="text-[var(--text-muted)] text-sm text-center py-4">
          No attendance data uploaded for {monthLabel(monthKey)} yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { label: 'Attendance Rate', value: `${kpis.attendanceRate.toFixed(1)}%`, color: 'text-emerald-400' },
              { label: 'Present Days', value: kpis.presentDays.toFixed(1), color: 'text-emerald-400' },
              { label: 'Absent Days', value: kpis.absentDays, color: 'text-red-400' },
              { label: 'Late Count', value: kpis.lateArrivalRate > 0 ? Math.round((kpis.lateArrivalRate / 100) * kpis.presentSampleSize) : 0, color: 'text-amber-400' },
              { label: 'Early Exit Count', value: kpis.earlyExitRate > 0 ? Math.round((kpis.earlyExitRate / 100) * kpis.presentSampleSize) : 0, color: 'text-amber-400' },
              { label: 'Productivity Lost', value: `${kpis.productivityLost.toFixed(1)}%`, color: 'text-orange-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-[var(--bg-elevated)]/50 rounded-xl p-3">
                <p className="text-[var(--text-muted)] text-xs mb-1">{label}</p>
                <p className={`text-lg font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Actual + Effective hours — always shown together, both
              labeled, per the "never an unlabeled single hours number"
              convention. */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[var(--bg-elevated)]/50 rounded-xl p-3">
              <p className="text-[var(--text-muted)] text-xs mb-1">Actual Hours / Day</p>
              <p className="text-lg font-bold text-blue-400">{kpis.avgActualHoursPerDay.toFixed(1)}h</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Raw punch duration, lunch included</p>
            </div>
            <div className="bg-[var(--bg-elevated)]/50 rounded-xl p-3">
              <p className="text-[var(--text-muted)] text-xs mb-1">Effective Hours / Day</p>
              <p className="text-lg font-bold text-blue-400">{kpis.avgEffectiveHoursPerDay.toFixed(1)}h</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Minus a 60-min lunch</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}