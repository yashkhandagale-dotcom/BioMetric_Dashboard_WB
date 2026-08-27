'use client';

import { useEffect, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { currentMonthKey, monthLabel, shiftMonthKey } from '@/lib/leaveCalendar';
import type { EmployeeAttendanceKPIs } from '@/lib/leaveSupabase/getEmployeeAttendanceKPIs';

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
    <div
      className="border border-[var(--border)] rounded-2xl p-5 space-y-4 shadow-md"
      style={{
        background: 'linear-gradient(160deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[var(--border-subtle)]">
        <div>
          <h2 className="text-base font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
            <Calendar size={16} className="text-[var(--accent)]" />
            Attendance Summary
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Biometric activity &amp; hours for <span className="font-semibold text-[var(--text-primary)]">{monthLabel(monthKey)}</span>
          </p>
        </div>

        {/* Month Selector */}
        <div className="flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-1 shadow-inner">
          <button
            type="button"
            onClick={() => setMonthKey((m) => shiftMonthKey(m, -1))}
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
            title="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-[var(--text-primary)] text-xs font-bold px-2 min-w-[100px] text-center">
            {monthLabel(monthKey)}
          </span>
          <button
            type="button"
            onClick={() => setMonthKey((m) => shiftMonthKey(m, 1))}
            disabled={monthKey >= currentMonthKey()}
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-xl px-3.5 py-2.5 font-medium">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-[var(--bg-elevated)]/60 animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-[var(--bg-elevated)]/60 animate-pulse" />
            ))}
          </div>
        </div>
      ) : !kpis || recordCount === 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {['Attendance Rate', 'Present Days', 'Absent Days', 'Late Count', 'Early Exit Count', 'Productivity Lost'].map((label) => (
              <div key={label} className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-3">
                <p className="text-[var(--text-muted)] text-[11px] font-medium">{label}</p>
                <p className="text-lg font-bold text-[var(--text-muted)]/50 mt-1">—</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {['Actual Hours / Day', 'Effective Hours / Day'].map((label) => (
              <div key={label} className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-3">
                <p className="text-[var(--text-muted)] text-[11px] font-medium">{label}</p>
                <p className="text-lg font-bold text-[var(--text-muted)]/50 mt-1">—</p>
              </div>
            ))}
          </div>
          <p className="text-[var(--text-muted)] text-xs text-center pt-2 font-medium">
            No attendance data uploaded for {monthLabel(monthKey)} yet.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {[
              {
                label: 'Attendance Rate',
                value: `${kpis.attendanceRate.toFixed(1)}%`,
                color: 'text-emerald-600 dark:text-emerald-300',
                bg: 'bg-emerald-500/10 border-emerald-500/20',
              },
              {
                label: 'Present Days',
                value: kpis.presentDays.toFixed(1),
                color: 'text-emerald-600 dark:text-emerald-300',
                bg: 'bg-emerald-500/10 border-emerald-500/20',
              },
              {
                label: 'Absent Days',
                value: kpis.absentDays,
                color: 'text-rose-600 dark:text-rose-300',
                bg: 'bg-rose-500/10 border-rose-500/20',
              },
              {
                label: 'Late Arrival Count',
                value: kpis.lateArrivalRate > 0 ? Math.round((kpis.lateArrivalRate / 100) * kpis.presentSampleSize) : 0,
                color: 'text-amber-600 dark:text-amber-300',
                bg: 'bg-amber-500/10 border-amber-500/20',
              },
              {
                label: 'Early Exit Count',
                value: kpis.earlyExitRate > 0 ? Math.round((kpis.earlyExitRate / 100) * kpis.presentSampleSize) : 0,
                color: 'text-amber-600 dark:text-amber-300',
                bg: 'bg-amber-500/10 border-amber-500/20',
              },
              {
                label: 'Productivity Lost',
                value: `${kpis.productivityLost.toFixed(1)}%`,
                color: 'text-orange-600 dark:text-orange-300',
                bg: 'bg-orange-500/10 border-orange-500/20',
              },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`rounded-xl p-3 border ${bg}`}>
                <p className="text-[var(--text-muted)] text-[10px] font-bold uppercase tracking-wider">{label}</p>
                <p className={`text-xl font-extrabold tabular-nums mt-1 ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Actual & Effective Hours */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-3.5 shadow-sm">
              <p className="text-[var(--text-muted)] text-[10px] font-bold uppercase tracking-wider">Actual Hours / Day</p>
              <p className="text-2xl font-black text-[var(--accent)] tabular-nums mt-1">{kpis.avgActualHoursPerDay.toFixed(1)}<span className="text-xs font-normal text-[var(--text-muted)] ml-1">hours</span></p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Raw punch duration (lunch included)</p>
            </div>
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-3.5 shadow-sm">
              <p className="text-[var(--text-muted)] text-[10px] font-bold uppercase tracking-wider">Effective Hours / Day</p>
              <p className="text-2xl font-black text-[var(--primary)] tabular-nums mt-1">{kpis.avgEffectiveHoursPerDay.toFixed(1)}<span className="text-xs font-normal text-[var(--text-muted)] ml-1">hours</span></p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Net work hours (standard lunch deducted)</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}