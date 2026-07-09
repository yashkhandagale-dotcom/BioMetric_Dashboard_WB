'use client';
import { useState, useRef, useMemo, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, FileIcon, ChevronDown, Loader2, X, Calendar, Building2, Users } from 'lucide-react';
import { UploadedMonth, Thresholds, Holiday } from '@/lib/types';
import { getRecords } from '@/lib/storage';
import { getAllLeaveRecords } from '@/lib/leaveStorage';
import { getHolidays } from '@/lib/holidays';
import { useDashboardData } from '@/lib/useDashboardData';
import { exportExcel, exportCSV } from '@/lib/exportData';

interface ExportPanelProps {
  uploadedMonths: UploadedMonth[];
  thresholds: Thresholds;
}

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodKey(m: UploadedMonth): string {
  return `${m.year}${m.month}`;
}
function periodLabel(key: string): string {
  const year = key.slice(0, 4);
  const month = key.slice(4, 6);
  return `${MONTH_NAMES[parseInt(month, 10)] || month} ${year}`;
}

// FR-11D: dedicated multi-month export dialog — From-month / To-month /
// Office / Department selectors spanning every uploaded month, rather than
// just exporting whatever happens to be on screen right now.
export default function ExportPanel({ uploadedMonths, thresholds }: ExportPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState<'excel' | 'csv' | 'pdf' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Scope selectors ─────────────────────────────────────────────────────
  const [fromPeriod, setFromPeriod] = useState('');
  const [toPeriod, setToPeriod] = useState('');
  const [office, setOffice] = useState('ALL');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);

  const periods = useMemo(() => {
    const set = new Set<string>();
    uploadedMonths.forEach(m => set.add(periodKey(m)));
    return Array.from(set).sort();
  }, [uploadedMonths]);

  const offices = useMemo(() => {
    return Array.from(new Set(uploadedMonths.map(m => m.officeCode))).sort();
  }, [uploadedMonths]);

  // Open the dialog with sensible defaults: latest uploaded month, all offices.
  function openDialog() {
    const latest = periods[periods.length - 1] ?? '';
    setFromPeriod(latest);
    setToPeriod(latest);
    setOffice('ALL');
    setSelectedDepts([]);
    setDialogOpen(true);
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Months within the selected From→To period + office ──────────────────
  const scopedMonths = useMemo(() => {
    if (!fromPeriod || !toPeriod) return [];
    const lo = fromPeriod <= toPeriod ? fromPeriod : toPeriod;
    const hi = fromPeriod <= toPeriod ? toPeriod : fromPeriod;
    return uploadedMonths.filter(m => {
      const k = periodKey(m);
      if (k < lo || k > hi) return false;
      if (office !== 'ALL' && m.officeCode !== office) return false;
      return true;
    });
  }, [uploadedMonths, fromPeriod, toPeriod, office]);

  const scopedRecords = useMemo(
    () => scopedMonths.flatMap(m => getRecords(m.key)),
    [scopedMonths]
  );

  const departments = useMemo(() => {
    return Array.from(new Set(scopedRecords.map(r => r.department))).filter(Boolean).sort();
  }, [scopedRecords]);

  // If the department list changes (different office/period picked) drop any
  // previously-selected department that's no longer in scope.
  useEffect(() => {
    setSelectedDepts(prev => prev.filter(d => departments.includes(d)));
  }, [departments]);

  const filteredRecords = useMemo(() => {
    if (selectedDepts.length === 0) return scopedRecords;
    return scopedRecords.filter(r => selectedDepts.includes(r.department));
  }, [scopedRecords, selectedDepts]);

  const holidays = useMemo(() => {
    const seen = new Set<string>();
    const all: Holiday[] = [];
    for (const m of scopedMonths) {
      const key = `${m.officeCode}_${m.year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(...getHolidays(m.officeCode, m.year));
    }
    return all;
  }, [scopedMonths]);

  const leaveRecords = useMemo(
    () => getAllLeaveRecords(scopedMonths.map(m => m.key)),
    [scopedMonths]
  );

  const { employeeSummaries } = useDashboardData(
    filteredRecords, 'ALL', [], [], holidays, thresholds, leaveRecords
  );

  const label = useMemo(() => {
    const officePart = office === 'ALL' ? 'AllOffices' : office;
    const periodPart = fromPeriod === toPeriod ? periodLabel(fromPeriod).replace(/\s+/g, '')
      : `${periodLabel(fromPeriod).replace(/\s+/g, '')}-${periodLabel(toPeriod).replace(/\s+/g, '')}`;
    const deptPart = selectedDepts.length > 0 ? `_${selectedDepts.join('-').replace(/\s+/g, '')}` : '';
    return `${officePart}_${periodPart}${deptPart}`;
  }, [office, fromPeriod, toPeriod, selectedDepts]);

  function toggleDept(d: string) {
    setSelectedDepts(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }

  const canExport = scopedMonths.length > 0 && filteredRecords.length > 0;

  async function handleExcel() {
    if (!canExport) return;
    setLoading('excel');
    await new Promise(r => setTimeout(r, 50));
    exportExcel(filteredRecords, employeeSummaries, label, leaveRecords);
    setLoading(null);
  }

  async function handleCSV() {
    if (!canExport) return;
    setLoading('csv');
    await new Promise(r => setTimeout(r, 50));
    exportCSV(filteredRecords, label, leaveRecords);
    setLoading(null);
  }

  async function handlePDF() {
    if (!canExport) return;
    setLoading('pdf');
    await new Promise(r => setTimeout(r, 50));
    const { exportPDF } = await import('@/lib/exportPDF');
    await exportPDF(filteredRecords, employeeSummaries, label);
    setLoading(null);
  }

  const disabled = uploadedMonths.length === 0;

  return (
    <>
      <button
        onClick={() => !disabled && openDialog()}
        disabled={disabled}
        className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Download className="w-4 h-4" />
        Export
      </button>

      {dialogOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setDialogOpen(false)}>
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-800 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-white font-semibold text-sm">Export Data</h3>
                <p className="text-slate-400 text-xs mt-1">Choose the months, office and departments to include — spans every uploaded month, not just what's on screen.</p>
              </div>
              <button onClick={() => setDialogOpen(false)} className="text-slate-500 hover:text-white transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              {/* From / To month */}
              <div>
                <label className="flex items-center gap-1.5 text-slate-400 text-xs font-medium mb-1.5">
                  <Calendar className="w-3.5 h-3.5" /> Month Range
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={fromPeriod}
                    onChange={(e) => setFromPeriod(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    {periods.map(p => <option key={p} value={p}>{periodLabel(p)}</option>)}
                  </select>
                  <span className="text-slate-600 text-xs flex-shrink-0">to</span>
                  <select
                    value={toPeriod}
                    onChange={(e) => setToPeriod(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    {periods.map(p => <option key={p} value={p}>{periodLabel(p)}</option>)}
                  </select>
                </div>
              </div>

              {/* Office */}
              <div>
                <label className="flex items-center gap-1.5 text-slate-400 text-xs font-medium mb-1.5">
                  <Building2 className="w-3.5 h-3.5" /> Office
                </label>
                <select
                  value={office}
                  onChange={(e) => setOffice(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="ALL">All Offices{offices.length > 1 ? ` (${offices.length})` : ''}</option>
                  {offices.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* Department */}
              <div>
                <label className="flex items-center gap-1.5 text-slate-400 text-xs font-medium mb-1.5">
                  <Users className="w-3.5 h-3.5" /> Departments
                  {selectedDepts.length > 0 && <span className="text-slate-600">({selectedDepts.length} selected)</span>}
                </label>
                {departments.length === 0 ? (
                  <p className="text-slate-600 text-xs">No department data in this scope.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    <button
                      onClick={() => setSelectedDepts([])}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${selectedDepts.length === 0 ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'}`}
                    >
                      All Departments
                    </button>
                    {departments.map(d => (
                      <button
                        key={d}
                        onClick={() => toggleDept(d)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${selectedDepts.includes(d) ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Scope summary */}
              <div className="bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-xs">
                {canExport ? (
                  <p className="text-slate-300">
                    <span className="text-emerald-400 font-medium">{scopedMonths.length}</span> month{scopedMonths.length !== 1 ? 's' : ''} ·{' '}
                    <span className="text-emerald-400 font-medium">{new Set(filteredRecords.map(r => r.employeeCode)).size}</span> employees ·{' '}
                    <span className="text-emerald-400 font-medium">{filteredRecords.length.toLocaleString()}</span> records
                  </p>
                ) : (
                  <p className="text-amber-400">No data matches this selection — adjust the range, office, or departments.</p>
                )}
              </div>
            </div>

            {/* Download actions */}
            <div className="px-5 py-4 border-t border-slate-800 grid grid-cols-3 gap-2">
              <button
                onClick={handleExcel}
                disabled={!canExport || loading !== null}
                className="flex flex-col items-center gap-1.5 py-3 rounded-lg text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 text-emerald-400" />}
                Excel
              </button>
              <button
                onClick={handleCSV}
                disabled={!canExport || loading !== null}
                className="flex flex-col items-center gap-1.5 py-3 rounded-lg text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4 text-blue-400" />}
                CSV
              </button>
              <button
                onClick={handlePDF}
                disabled={!canExport || loading !== null}
                className="flex flex-col items-center gap-1.5 py-3 rounded-lg text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileIcon className="w-4 h-4 text-red-400" />}
                PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}