'use client';
import { useState, useMemo, useRef } from 'react';
import { Upload, CheckCircle, X, AlertCircle, ChevronDown, ChevronUp, Flag } from 'lucide-react';
import Papa from 'papaparse';
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

function parsePayrollDateRange(filename: string): { from: string; to: string } | null {
  // Payroll CSV covers 25th of month to 24th of next month
  // We detect range from data itself, not filename
  return null;
}

export default function HRAbsenceChecker({ allUploadedRecords }: HRAbsenceCheckerProps) {
  const [open, setOpen] = useState(false);
  const [csvRecords, setCsvRecords] = useState<AttendanceRecord[]>([]);
  const [dateRange, setDateRange] = useState<{ from: string; to: string } | null>(null);
  const [flagMap, setFlagMap] = useState<Map<string, boolean>>(new Map()); // key = empCode__date
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [filterDept, setFilterDept] = useState('ALL');
  const fileRef = useRef<HTMLInputElement>(null);

  // Use uploaded biometric records (passed in) filtered to the payroll date range
  const baseRecords = allUploadedRecords;

  function handleCSVUpload(file: File) {
    // The HR payroll CSV may have employee codes and date columns we can use
    // OR it may simply be a list of employee codes and a date range
    // We'll parse it to extract the date range (from/to)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data as Record<string, string>[];
        if (rows.length === 0) return;

        // Try to find date range from data
        const dateColumns = Object.keys(rows[0]).filter(k =>
          k.toLowerCase().includes('date') || /^\d{4}-\d{2}-\d{2}$/.test(rows[0][k])
        );

        let allDates: string[] = [];
        for (const row of rows) {
          for (const col of dateColumns) {
            const v = row[col]?.trim();
            if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) allDates.push(v);
          }
          // Also check all values
          for (const v of Object.values(row)) {
            const trimmed = v?.trim();
            if (trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) allDates.push(trimmed);
          }
        }

        if (allDates.length > 0) {
          allDates.sort();
          setDateRange({ from: allDates[0], to: allDates[allDates.length - 1] });
        } else {
          // Infer from biometric records available - use all dates
          const recordDates = baseRecords.map(r => r.date).sort();
          if (recordDates.length > 0) {
            // Default to payroll period: find 25th of earliest month to 24th of next
            const firstDate = new Date(recordDates[0]);
            const from = new Date(firstDate.getFullYear(), firstDate.getMonth() - 1, 25);
            const to = new Date(firstDate.getFullYear(), firstDate.getMonth(), 24);
            setDateRange({
              from: from.toISOString().slice(0, 10),
              to: to.toISOString().slice(0, 10),
            });
          }
        }
      }
    });
  }

  // Build absence list from biometric records in date range
  const absenceData = useMemo(() => {
    const records = dateRange
      ? baseRecords.filter(r => r.date >= dateRange.from && r.date <= dateRange.to)
      : baseRecords;

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

    // Apply saved flags
    for (const [k, flagged] of flagMap.entries()) {
      const [code, date] = k.split('__');
      const emp = empMap.get(code);
      if (emp) {
        if (flagged) emp.flaggedDates.add(date);
        else emp.flaggedDates.delete(date);
      }
    }

    return Array.from(empMap.values()).sort((a, b) => b.absentDates.length - a.absentDates.length);
  }, [baseRecords, dateRange, flagMap]);

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
              {dateRange
                ? `Payroll: ${dateRange.from} → ${dateRange.to} · ${pendingCount} absences to review`
                : 'Upload payroll CSV to set period · click to expand'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs px-2 py-0.5 rounded-full font-medium">
              {pendingCount} pending
            </span>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-slate-700">
          {/* Upload + controls row */}
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleCSVUpload(f); e.target.value = ''; }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white text-xs px-3 py-2 rounded-lg transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload Payroll CSV (25th–24th)
              </button>
            </div>

            {/* Manual date range override */}
            <div className="flex items-center gap-2 bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5">
              <span className="text-slate-400 text-xs">From</span>
              <input
                type="date"
                value={dateRange?.from ?? ''}
                onChange={e => setDateRange(prev => ({ from: e.target.value, to: prev?.to ?? '' }))}
                className="bg-transparent text-white text-xs focus:outline-none w-28"
              />
              <span className="text-slate-600 text-xs">→</span>
              <span className="text-slate-400 text-xs">To</span>
              <input
                type="date"
                value={dateRange?.to ?? ''}
                onChange={e => setDateRange(prev => ({ from: prev?.from ?? '', to: e.target.value }))}
                className="bg-transparent text-white text-xs focus:outline-none w-28"
              />
            </div>

            {/* Dept filter */}
            <select
              value={filterDept}
              onChange={e => setFilterDept(e.target.value)}
              className="bg-slate-700 border border-slate-600 text-white text-xs rounded-lg px-3 py-2 focus:outline-none"
            >
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            {/* Stats */}
            <div className="flex gap-2 text-xs ml-auto">
              <span className="bg-slate-700 text-slate-300 px-2 py-1 rounded">{totalAbsences} absences</span>
              <span className="bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 px-2 py-1 rounded">{flaggedCount} marked leave ✓</span>
              <span className="bg-rose-600/20 text-rose-400 border border-rose-500/30 px-2 py-1 rounded">{pendingCount} to review</span>
            </div>
          </div>

          {/* Instructions */}
          <div className="mt-3 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-2.5 text-xs text-blue-300">
            <strong>How to use:</strong> Review each absent day below. Click <Flag className="w-3 h-3 inline mx-0.5" /> to mark a date as approved leave. Unmarked dates = unaccounted absences that need HR action.
          </div>

          {/* Employee absence list */}
          {filtered.length === 0 ? (
            <div className="mt-4 text-center py-8 text-slate-500 text-sm">
              {dateRange ? 'No absences found in this period 🎉' : 'Set a date range to view absences'}
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