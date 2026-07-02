'use client';
import { useState, useMemo } from 'react';
import { CheckCircle, ChevronDown, ChevronUp, Flag, Search } from 'lucide-react';
import { AttendanceRecord } from '@/lib/types';
import { isAbsent, isWeeklyOff } from '@/lib/useDashboardData';

interface PayrollRecord {
  employeeCode: string;
  employeeName: string;
  department: string;
  absentDates: string[];
  flaggedDates: Set<string>; // marked as leave by HR
}

interface HRAbsenceCheckerProps {
  allUploadedRecords: AttendanceRecord[];
}

// Payroll month "April" -> 25 March to 24 April.
// selectedMonth is an <input type="month"> value: "YYYY-MM" (MM = 1-12).
function payrollRangeForMonth(selectedMonth: string): { from: string; to: string } {
  const [yearStr, monthStr] = selectedMonth.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1; // 0-based, e.g. April -> 3

  const fromDate = new Date(year, monthIndex - 1, 25); // 25th of previous month
  const toDate = new Date(year, monthIndex, 24);        // 24th of selected month

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(fromDate), to: fmt(toDate) };
}

function formatMonthLabel(selectedMonth: string): string {
  const [yearStr, monthStr] = selectedMonth.split('-');
  const d = new Date(Number(yearStr), Number(monthStr) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function HRAbsenceChecker({ allUploadedRecords }: HRAbsenceCheckerProps) {
  const [open, setOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(''); // "YYYY-MM"
  const [dateRange, setDateRange] = useState<{ from: string; to: string } | null>(null);
  const [flagMap, setFlagMap] = useState<Map<string, boolean>>(new Map()); // key = empCode__date
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [filterDept, setFilterDept] = useState('ALL');
  const [submitted, setSubmitted] = useState(false); // gate: list only shows after HR applies filter

  const baseRecords = allUploadedRecords;

  // Any change to the month invalidates the current view —
  // HR must explicitly re-apply to see results for the new period.
  function updateSelectedMonth(month: string) {
    setSelectedMonth(month);
    setSubmitted(false);
  }

  function applyFilter() {
    if (!selectedMonth) return;
    setDateRange(payrollRangeForMonth(selectedMonth));
    setSubmitted(true);
  }

  // Build absence list from biometric records in date range
  // — only computed for display once HR has hit "Show Absences"
  const absenceData = useMemo(() => {
    if (!submitted || !dateRange) return [];

    const records = baseRecords.filter(r => r.date >= dateRange.from && r.date <= dateRange.to);

    const empMap = new Map<string, PayrollRecord>();
    for (const r of records) {
      if (isWeeklyOff(r.status)) continue;
      if (!isAbsent(r.status)) continue;

      const key = r.employeeCode;
      if (!empMap.has(key)) {
        empMap.set(key, {
          employeeCode: r.employeeCode,
          employeeName: r.employeeName || r.employeeCode,
          department: r.department || 'Unknown',
          absentDates: [],
          flaggedDates: new Set(),
        });
      }
      empMap.get(key)!.absentDates.push(r.date);
    }

    for (const [k, flagged] of flagMap.entries()) {
      const [code, date] = k.split('__');
      const emp = empMap.get(code);
      if (emp) {
        if (flagged) emp.flaggedDates.add(date);
        else emp.flaggedDates.delete(date);
      }
    }

    return Array.from(empMap.values()).sort((a, b) => b.absentDates.length - a.absentDates.length);
  }, [baseRecords, dateRange, flagMap, submitted]);

  const departments = useMemo(() => {
    const s = new Set(absenceData.map(e => e.department));
    return ['ALL', ...Array.from(s).sort()];
  }, [absenceData]);

  const filtered = useMemo(() => {
    if (filterDept === 'ALL') return absenceData;
    return absenceData.filter(e => e.department === filterDept);
  }, [absenceData, filterDept]);

  function toggleFlag(empCode: string, date: string) {
    const k = `${empCode}__${date}`;
    setFlagMap(prev => {
      const next = new Map(prev);
      next.set(k, !prev.get(k));
      return next;
    });
  }

  const totalAbsences = filtered.reduce((s, e) => s + e.absentDates.length, 0);
  const flaggedCount = filtered.reduce((s, e) => {
    return s + e.absentDates.filter(d => flagMap.get(`${e.employeeCode}__${d}`)).length;
  }, 0);
  const pendingCount = totalAbsences - flaggedCount;

  const canApply = !!selectedMonth;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-700/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-rose-600/20 border border-rose-500/30 rounded-lg flex items-center justify-center">
            <CheckCircle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-left">
            <h3 className="text-white font-semibold text-sm">HR Absence Checker</h3>
            <p className="text-slate-500 text-xs mt-0.5">
              {submitted && dateRange
                ? `${formatMonthLabel(selectedMonth)} payroll: ${dateRange.from} → ${dateRange.to} · ${pendingCount} absences to review`
                : 'Select a payroll month and apply to view absences'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {submitted && pendingCount > 0 && (
            <span className="bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs px-2 py-0.5 rounded-full font-medium">
              {pendingCount} pending
            </span>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-slate-700">
          {/* Controls row */}
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            {/* Month picker */}
            <div className="flex items-center gap-2 bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5">
              <span className="text-slate-400 text-xs">Payroll Month</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={e => updateSelectedMonth(e.target.value)}
                className="bg-transparent text-white text-xs focus:outline-none"
              />
            </div>

            {/* Live preview of computed range */}
            {selectedMonth && (
              <span className="text-slate-500 text-xs">
                = {payrollRangeForMonth(selectedMonth).from} → {payrollRangeForMonth(selectedMonth).to}
              </span>
            )}

            {/* Dept filter */}
            <select
              value={filterDept}
              onChange={e => setFilterDept(e.target.value)}
              disabled={!submitted}
              className="bg-slate-700 border border-slate-600 text-white text-xs rounded-lg px-3 py-2 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            {/* Apply button — gates the list */}
            <button
              onClick={applyFilter}
              disabled={!canApply}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs px-3 py-2 rounded-lg transition-colors font-medium"
            >
              <Search className="w-3.5 h-3.5" />
              Show Absences
            </button>

            {/* Stats — only meaningful once results are shown */}
            {submitted && (
              <div className="flex gap-2 text-xs ml-auto">
                <span className="bg-slate-700 text-slate-300 px-2 py-1 rounded">{totalAbsences} absences</span>
                <span className="bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 px-2 py-1 rounded">{flaggedCount} marked leave ✓</span>
                <span className="bg-rose-600/20 text-rose-400 border border-rose-500/30 px-2 py-1 rounded">{pendingCount} to review</span>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="mt-3 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-2.5 text-xs text-blue-300">
            <strong>How to use:</strong> Pick the payroll month (e.g. "April" covers 25 Mar – 24 Apr), then click <strong>Show Absences</strong>. Review each absent day and click <Flag className="w-3 h-3 inline mx-0.5" /> to mark it as approved leave. Unmarked dates = unaccounted absences that need HR action.
          </div>

          {/* Employee absence list — gated behind submitted */}
          {!submitted ? (
            <div className="mt-4 text-center py-8 text-slate-500 text-sm">
              {canApply ? 'Click "Show Absences" to load results for this month' : 'Select a payroll month to get started'}
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-4 text-center py-8 text-slate-500 text-sm">
              No absences found in this period 🎉
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {filtered.map(emp => {
                const isExpanded = expandedEmp === emp.employeeCode;
                const empFlagged = emp.absentDates.filter(d => flagMap.get(`${emp.employeeCode}__${d}`)).length;
                const empPending = emp.absentDates.length - empFlagged;

                return (
                  <div key={emp.employeeCode} className="bg-slate-700/40 rounded-lg border border-slate-600/50 overflow-hidden">
                    <button
                      onClick={() => setExpandedEmp(isExpanded ? null : emp.employeeCode)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/60 transition-colors"
                    >
                      <div className="flex items-center gap-3 text-left">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${empPending > 0 ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                        <div>
                          <span className="text-white text-xs font-medium">{emp.employeeName}</span>
                          <span className="text-slate-500 text-xs ml-2">({emp.employeeCode})</span>
                          <span className="text-slate-400 text-xs ml-2">· {emp.department}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-400">{emp.absentDates.length} absent</span>
                        {empFlagged > 0 && <span className="text-emerald-400">{empFlagged} ✓</span>}
                        {empPending > 0 && <span className="text-rose-400">{empPending} pending</span>}
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-3 border-t border-slate-600/50">
                        <div className="flex flex-wrap gap-2 mt-3">
                          {emp.absentDates.sort().map(date => {
                            const isFlagged = !!flagMap.get(`${emp.employeeCode}__${date}`);
                            return (
                              <button
                                key={date}
                                onClick={() => toggleFlag(emp.employeeCode, date)}
                                title={isFlagged ? 'Marked as leave — click to undo' : 'Click to mark as leave'}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                  isFlagged
                                    ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300 line-through opacity-70'
                                    : 'bg-slate-600/50 border-slate-500/50 text-slate-300 hover:bg-rose-600/20 hover:border-rose-500/40 hover:text-rose-300'
                                }`}
                              >
                                {isFlagged ? <CheckCircle className="w-3 h-3" /> : <Flag className="w-3 h-3" />}
                                {date.slice(5)} {/* MM-DD */}
                              </button>
                            );
                          })}
                        </div>
                        {empFlagged === emp.absentDates.length && (
                          <p className="text-emerald-400 text-xs mt-2">✓ All absences accounted for</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}