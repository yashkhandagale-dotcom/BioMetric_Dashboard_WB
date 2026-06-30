'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Upload, CheckCircle, Eye, ShieldX, Calendar, Settings as SettingsIcon } from 'lucide-react';
import { AttendanceRecord, ColumnMapping, EmployeeSummary, UploadedMonth, Holiday, Thresholds, LeaveRecord } from '@/lib/types';
import {
  getMapping, saveMapping, getRecords, saveRecords, addUploadedMonth, getUploadedMonths,
} from '@/lib/storage';
import { getThresholds, saveThresholds } from '@/lib/settings';
import { getLeaveRecords } from '@/lib/leaveStorage';
import { buildLeaveMap } from '@/lib/useDashboardData';
import { parseCSVHeaders, parseCSVWithMapping } from '@/lib/parseCSV';
import { validateFile } from '@/lib/validateFile';
import { readSharedData } from '@/lib/sharedLink';
import { useDashboardData } from '@/lib/useDashboardData';
import { getHolidays } from '@/lib/holidays';
import UploadZone from '@/components/UploadZone';
import ColumnMappingScreen from '@/components/ColumnMappingScreen';
import ConfirmDialog from '@/components/ConfirmDialog';
import KPICards from '@/components/KPICards';
import AbsenceBreakdown from '@/components/AbsenceBreakdown';
import EmployeeTable from '@/components/EmployeeTable';
import {
  DailyTrendChart, DeptAttendanceChart, HoursDistributionChart, AbsenceSpikeChart,
  ProductivityLostChart, DeptProductivityChart, OfficeAttendanceChart
} from '@/components/Charts';
import ExportPanel from '@/components/ExportPanel';
import EmployeePanel from '@/components/EmployeePanel';
import TeamComparisonPanel from '@/components/TeamComparisonPanel';
<<<<<<< HEAD
import EmployeeComparisonPanel from '@/components/EmployeeComparisonPanel';
import HolidayModal from '@/components/HolidayModal';
=======
>>>>>>> cebf57734252972c02faeb3b937994acd23704bf
import InsightsStrip from '@/components/InsightsStrip';
import SettingsPanel from '@/components/SettingsPanel';

type AppState = 'upload' | 'mapping' | 'dashboard';
type ViewMode = 'loading' | 'hr' | 'manager' | 'denied';
interface Toast { type: 'success' | 'error'; message: string; }
interface PendingFile { file: File; officeCode: string; month: string; year: string; }
interface MappingQueueItem { officeCode: string; headers: string[]; }

function getMonthName(mm: string): string {
  const m = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return m[parseInt(mm, 10)] || mm;
}

function getYearFromKey(key: string): string {
  return key.split('_')[0] || new Date().getFullYear().toString();
}

function getOfficeFromKey(key: string): string {
  const parts = key.split('_');
  return parts.length >= 3 ? parts[2] : '';
}

// ── Manager read-only view ────────────────────────────────────────────────────
function ManagerView({ records }: { records: AttendanceRecord[] }) {
  const [selectedEmp, setSelectedEmp] = useState<EmployeeSummary | null>(null);
  const { kpi, employeeSummaries, dailyTrend, deptAttendance, hoursDistribution } =
    useDashboardData(records, 'ALL', []);

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">WB</span>
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm">Attendance Dashboard</h1>
            <p className="text-slate-500 text-xs">WonderBiz Technologies · Management View</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg">
          <Eye className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-slate-400 text-xs">Read-only · {records.length.toLocaleString()} records</span>
        </div>
      </header>
      <main className="px-6 py-6 max-w-7xl mx-auto space-y-6">
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-sm text-blue-300">
          Read-only view — upload, export and settings are not available here.
        </div>
        <KPICards kpi={kpi} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <DailyTrendChart data={dailyTrend} />
          <HoursDistributionChart data={hoursDistribution} allRecords={records} />
        </div>
        <DeptAttendanceChart data={deptAttendance} allRecords={records} />
        <div className="bg-slate-800/30 rounded-xl border border-slate-700 p-4">
          <h2 className="text-white font-semibold text-sm mb-4">Employee Summary</h2>
          <EmployeeTable summaries={employeeSummaries} onEmployeeClick={setSelectedEmp} />
        </div>
      </main>
      <EmployeePanel employee={selectedEmp} onClose={() => setSelectedEmp(null)} readOnly />
    </div>
  );
}

// ── HR Dashboard inner ────────────────────────────────────────────────────────
function HRDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [appState, setAppState] = useState<AppState>('upload');
  const [toast, setToast] = useState<Toast | null>(null);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeSummary | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // B2: multi-file upload pipeline state
  const [pendingBatch, setPendingBatch] = useState<PendingFile[]>([]);
  const [skippedFiles, setSkippedFiles] = useState<{ name: string; reason: string }[]>([]);
  const [mappingQueue, setMappingQueue] = useState<MappingQueueItem[]>([]);
  const [remapInitial, setRemapInitial] = useState<Partial<ColumnMapping> | undefined>(undefined);
  const [conflictMonths, setConflictMonths] = useState<{ key: string; label: string }[] | null>(null);

  const [allRecords, setAllRecords] = useState<AttendanceRecord[]>([]);
  const [uploadedMonths, setUploadedMonths] = useState<UploadedMonth[]>([]);
  const [selectedMonthKey, setSelectedMonthKey] = useState('');
  const [selectedOffice, setSelectedOffice] = useState('ALL');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [tableFilter, setTableFilter] = useState<string>('all');
  const [thresholds, setThresholds] = useState<Thresholds>(getThresholds());
  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);
  const [allOfficeRecords, setAllOfficeRecords] = useState<AttendanceRecord[]>([]);

  // Load holidays + leave records when month key changes
  useEffect(() => {
    if (!selectedMonthKey) return;
    const officeCode = getOfficeFromKey(selectedMonthKey);
    const year = getYearFromKey(selectedMonthKey);
    setHolidays(getHolidays(officeCode, year));
    setLeaveRecords(getLeaveRecords(selectedMonthKey));

    // A7: gather records from every uploaded office for the SAME month/year,
    // independent of the office filter, so the office comparison chart works.
    const months = getUploadedMonths();
    const month = selectedMonthKey.split('_')[1];
    const sameMonth = months.filter(m => m.month === month && m.year === year);
    setAllOfficeRecords(sameMonth.flatMap(m => getRecords(m.key)));
  }, [selectedMonthKey]);

  // A8: re-mapping headers surfaced from SettingsPanel
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail as { officeCode: string; headers: string[]; mapping: ColumnMapping };
      setShowSettings(false);
      setMappingQueue([{ officeCode: detail.officeCode, headers: detail.headers }]);
      setRemapInitial(detail.mapping);
      setAppState('mapping');
    }
    window.addEventListener('remap-headers', handler);
    return () => window.removeEventListener('remap-headers', handler);
  }, []);

  // Sync URL → state on mount
  useEffect(() => {
    const months = getUploadedMonths();
    if (months.length === 0) return;
    setUploadedMonths(months);
    const monthParam = searchParams.get('month');
    const officeParam = searchParams.get('office');
    const deptParam = searchParams.get('dept');
    const matchMonth = months.find(m => m.key === monthParam) ?? months[months.length - 1];
    setSelectedMonthKey(matchMonth.key);
    setAllRecords(getRecords(matchMonth.key));
    if (officeParam) setSelectedOffice(officeParam);
    if (deptParam) setSelectedDepts(deptParam.split(',').filter(Boolean));
    setAppState('dashboard');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const syncURL = useCallback((monthKey: string, office: string, depts: string[]) => {
    const params = new URLSearchParams();
    if (monthKey) params.set('month', monthKey);
    if (office && office !== 'ALL') params.set('office', office);
    if (depts.length > 0) params.set('dept', depts.join(','));
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '/', { scroll: false });
  }, [router]);

  function showToast(type: Toast['type'], message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 6000);
  }

  // ── B2: multi-file upload pipeline ──────────────────────────────────────────
  async function handleFiles(files: File[]) {
    const valid: PendingFile[] = [];
    const skipped: { name: string; reason: string }[] = [];

    for (const file of files) {
      const result = validateFile(file);
      if (!result.valid) {
        skipped.push({ name: file.name, reason: result.error || 'Invalid file' });
        continue;
      }
      valid.push({ file, officeCode: result.officeCode!, month: result.month!, year: result.year! });
    }
    setSkippedFiles(skipped);

    if (valid.length === 0) {
      if (skipped.length > 0) {
        showToast('error', `No files imported. ${skipped.length} skipped: ${skipped.map(s => `${s.name} (${s.reason.split('\n')[0]})`).join('; ')}`);
      }
      return;
    }

    setPendingBatch(valid);

    // Determine which distinct offices in this batch need a fresh mapping
    const queue: MappingQueueItem[] = [];
    const seen = new Set<string>();
    for (const pf of valid) {
      if (seen.has(pf.officeCode)) continue;
      seen.add(pf.officeCode);
      if (!getMapping(pf.officeCode)) {
        const headers = await parseCSVHeaders(pf.file);
        queue.push({ officeCode: pf.officeCode, headers });
      }
    }

    if (queue.length > 0) {
      setMappingQueue(queue);
      setRemapInitial(undefined);
      setAppState('mapping');
    } else {
      await proceedToConflictCheck(valid);
    }
  }

  async function handleMappingSave(mapping: ColumnMapping) {
    const current = mappingQueue[0];
    if (!current) return;
    saveMapping(current.officeCode, mapping);

    const remaining = mappingQueue.slice(1);
    if (remaining.length > 0) {
      setMappingQueue(remaining);
      setRemapInitial(undefined);
      return; // stay in 'mapping' state for next office in queue
    }

    setMappingQueue([]);
    setRemapInitial(undefined);

    if (remapInitial !== undefined && pendingBatch.length === 0) {
      // This save came from a Settings → Remap action, not a fresh upload batch.
      setAppState('dashboard');
      showToast('success', `Column mapping updated for ${current.officeCode}.`);
      return;
    }

    await proceedToConflictCheck(pendingBatch);
  }

  async function proceedToConflictCheck(batch: PendingFile[]) {
    const months = getUploadedMonths();
    const conflicts: { key: string; label: string }[] = [];
    for (const pf of batch) {
      const key = `${pf.year}_${pf.month}_${pf.officeCode}`;
      const existing = months.find(m => m.key === key);
      if (existing) conflicts.push({ key, label: existing.label });
    }
    if (conflicts.length > 0) {
      setConflictMonths(conflicts);
    } else {
      await importBatch(batch);
    }
  }

  async function importBatch(batch: PendingFile[]) {
    setConflictMonths(null);
    const results: string[] = [];
    let lastMonthKey = '';

    for (const pf of batch) {
      const mapping = getMapping(pf.officeCode);
      if (!mapping) continue; // shouldn't happen — mapping queue guarantees this
      const { records } = await parseCSVWithMapping(pf.file, mapping, pf.officeCode, thresholds.graceMinutes);
      const monthKey = `${pf.year}_${pf.month}_${pf.officeCode}`;
      const monthLabel = `${pf.officeCode} \u2014 ${getMonthName(pf.month)} ${pf.year}`;
      const { added, updated } = saveRecords(monthKey, records);
      addUploadedMonth({ key: monthKey, label: monthLabel, officeCode: pf.officeCode, month: pf.month, year: pf.year });
      lastMonthKey = monthKey;
      results.push(`${pf.officeCode} ${getMonthName(pf.month)} ${pf.year} (${added} new, ${updated} updated)`);
    }

    const months = getUploadedMonths();
    setUploadedMonths(months);
    if (lastMonthKey) {
      setAllRecords(getRecords(lastMonthKey));
      setSelectedMonthKey(lastMonthKey);
      syncURL(lastMonthKey, 'ALL', []);
    }
    setSelectedOffice('ALL');
    setSelectedDepts([]);
    setTableFilter('all');
    setAppState('dashboard');
    setPendingBatch([]);

    const skipNote = skippedFiles.length > 0
      ? ` ${skippedFiles.length} file skipped: ${skippedFiles.map(s => `'${s.name}' (${s.reason.split('\n')[0]})`).join(', ')}.`
      : '';
    showToast('success', `Imported ${batch.length} file${batch.length > 1 ? 's' : ''}: ${results.join(', ')}.${skipNote}`);
    setSkippedFiles([]);
  }

  function handleMonthChange(key: string) {
    setSelectedMonthKey(key);
    setAllRecords(getRecords(key));
    setSelectedOffice('ALL');
    setSelectedDepts([]);
    setTableFilter('all');
    syncURL(key, 'ALL', []);
  }

  function handleOfficeChange(o: string) {
    setSelectedOffice(o);
    syncURL(selectedMonthKey, o, selectedDepts);
  }

  function toggleDept(d: string) {
    const next = selectedDepts.includes(d) ? selectedDepts.filter(x => x !== d) : [...selectedDepts, d];
    setSelectedDepts(next);
    syncURL(selectedMonthKey, selectedOffice, next);
  }

  function clearDepts() {
    setSelectedDepts([]);
    syncURL(selectedMonthKey, selectedOffice, []);
  }

  function refreshLeaveRecords() {
    if (selectedMonthKey) setLeaveRecords(getLeaveRecords(selectedMonthKey));
  }

  function handleSaveThresholds(t: Thresholds) {
    saveThresholds(t);
    setThresholds(t);
    showToast('success', 'Thresholds updated.');
  }

  const { kpi, employeeSummaries, dailyTrend, deptAttendance, hoursDistribution, officeAttendance, departments, offices, filteredRecords } =
    useDashboardData(allRecords, selectedOffice, selectedDepts, [], holidays, thresholds, leaveRecords, allOfficeRecords);

  const leaveMap = buildLeaveMap(leaveRecords);

  const currentMonth = uploadedMonths.find(m => m.key === selectedMonthKey);
  const baseLabel = currentMonth ? `${currentMonth.officeCode}_${currentMonth.month}${currentMonth.year}` : 'ALL';
  const exportLabel = selectedDepts.length > 0
    ? `${baseLabel}_${selectedDepts.join('-').replace(/\s+/g, '')}`
    : baseLabel;

  const currentOffice = getOfficeFromKey(selectedMonthKey);
  const currentYear = getYearFromKey(selectedMonthKey);

  const filteredSummaries = tableFilter === 'all' ? employeeSummaries
    : tableFilter === 'present' ? employeeSummaries.filter(e => e.presentDays > 0)
    : tableFilter === 'absent' ? employeeSummaries.filter(e => e.absentDays > 0)
    : tableFilter === 'late' ? employeeSummaries.filter(e => e.lateCount > 0)
    : tableFilter === 'earlyexit' ? employeeSummaries.filter(e => e.earlyExitCount > 0)
    : tableFilter === 'shortday' ? employeeSummaries.filter(e => e.shortDayCount > 0)
    : tableFilter === 'frequentpunch' ? employeeSummaries.filter(e => e.frequentPunchDays > 0)
    : employeeSummaries;

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-start gap-3 max-w-md px-4 py-3 rounded-xl shadow-2xl border
          ${toast.type === 'success' ? 'bg-emerald-900/90 border-emerald-500/40 text-emerald-200' : 'bg-red-900/90 border-red-500/40 text-red-200'}`}>
          <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{toast.message}</p>
        </div>
      )}

      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">WB</span>
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm">Attendance Dashboard</h1>
            <p className="text-slate-500 text-xs">WonderBiz Technologies · HR View</p>
          </div>
        </div>
        {appState === 'dashboard' && (
          <div className="flex items-center gap-2">
            {holidays.length > 0 && (
              <span
                className="flex items-center gap-1.5 bg-purple-600/20 border border-purple-500/30 text-purple-400 px-3 py-1.5 rounded-lg text-xs font-medium"
                title="Manage holidays from Settings"
              >
                <Calendar className="w-3.5 h-3.5" />
                🗓 {holidays.length} Holiday{holidays.length !== 1 ? 's' : ''}
              </span>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 px-2 py-1.5 rounded-lg text-xs transition-colors"
              title="Settings"
            >
              <SettingsIcon className="w-3.5 h-3.5" /> Settings
            </button>
            <ExportPanel records={filteredRecords} summaries={employeeSummaries} label={exportLabel} leaveRecords={leaveRecords} />
            <button onClick={() => setAppState('upload')}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <Upload className="w-4 h-4" /> Upload CSV
            </button>
          </div>
        )}
      </header>

      <main className="px-6 py-6 max-w-7xl mx-auto">
        {appState === 'upload' && <UploadZone onFiles={handleFiles} />}
        {appState === 'mapping' && mappingQueue.length > 0 && (
          <ColumnMappingScreen
            officeCode={mappingQueue[0].officeCode}
            csvHeaders={mappingQueue[0].headers}
            initialMapping={remapInitial}
            onSave={handleMappingSave}
            onCancel={() => { setMappingQueue([]); setPendingBatch([]); setRemapInitial(undefined); setAppState(uploadedMonths.length > 0 ? 'dashboard' : 'upload'); }}
          />
        )}
        {appState === 'dashboard' && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <select value={selectedMonthKey} onChange={e => handleMonthChange(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                {uploadedMonths.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
              <div className="flex gap-1">
                {['ALL', ...offices].map(o => (
                  <button key={o} onClick={() => handleOfficeChange(o)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedOffice === o ? 'bg-blue-600 text-white' : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    {o}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {departments.map(d => (
                  <button key={d} onClick={() => toggleDept(d)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${selectedDepts.includes(d) ? 'bg-violet-600 text-white' : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    {d}
                  </button>
                ))}
                {selectedDepts.length > 0 && (
                  <button onClick={clearDepts} className="px-2.5 py-1 rounded-lg text-xs text-slate-500 hover:text-white transition-colors">Clear</button>
                )}
              </div>
            </div>

            {/* 8-card KPI grid — clickable */}
            <KPICards kpi={kpi} thresholds={thresholds} onCardClick={(f) => setTableFilter(f === tableFilter ? 'all' : f)} />

            {/* B7.3: absence breakdown */}
            <AbsenceBreakdown kpi={kpi} />

            {/* Charts grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <DailyTrendChart data={dailyTrend} selectedDepts={selectedDepts} />
              <AbsenceSpikeChart data={dailyTrend} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <ProductivityLostChart data={dailyTrend} />
              <HoursDistributionChart data={hoursDistribution} allRecords={allRecords} selectedDepts={selectedDepts} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <DeptAttendanceChart
                data={deptAttendance}
                allRecords={allRecords}
                selectedDepts={selectedDepts}
                onDeptClick={(dept) => toggleDept(dept)}
              />
              <DeptProductivityChart data={deptAttendance} />
            </div>

            {/* A7: office-wise attendance comparison */}
            <OfficeAttendanceChart data={officeAttendance} />

            {/* Dept comparison */}
            <TeamComparisonPanel allRecords={allRecords} departments={departments} />

            {/* Employee comparison: vs colleague, or vs own previous month */}
            <EmployeeComparisonPanel
              allRecords={filteredRecords}
              employeeSummaries={employeeSummaries}
              leaveRecords={leaveRecords}
              holidays={holidays}
              graceMinutes={thresholds.graceMinutes}
            />

            {/* Insights */}
            <InsightsStrip
              summaries={employeeSummaries}
              dailyTrend={dailyTrend}
              deptAttendance={deptAttendance}
              records={filteredRecords}
              selectedDepts={selectedDepts}
            />

            {/* Employee table — filter chip header */}
            <div className="bg-slate-800/30 rounded-xl border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold text-sm">
                  Employee Summary
                  {tableFilter !== 'all' && (
                    <span className="ml-2 text-xs text-slate-400 font-normal">
                      · filtered by <span className="text-blue-400 capitalize">{tableFilter}</span>
                      <button onClick={() => setTableFilter('all')} className="ml-2 text-slate-600 hover:text-slate-300">✕</button>
                    </span>
                  )}
                </h2>
                <span className="text-slate-500 text-xs">{filteredSummaries.length} employees</span>
              </div>
              <EmployeeTable summaries={filteredSummaries} onEmployeeClick={setSelectedEmp} />
            </div>
          </div>
        )}
      </main>

      {/* Employee slide-in panel */}
      <EmployeePanel
        employee={selectedEmp}
        onClose={() => setSelectedEmp(null)}
        holidays={holidays}
        graceMinutes={thresholds.graceMinutes}
        monthKey={selectedMonthKey}
        leaveMap={leaveMap}
        onLeaveChange={refreshLeaveRecords}
      />

      {/* A8: Settings panel (now also hosts holiday management) */}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          thresholds={thresholds}
          onSaveThresholds={handleSaveThresholds}
          records={allRecords}
          officeCode={currentOffice}
          year={currentYear}
          holidays={holidays}
          onHolidaysSaved={(h) => setHolidays(h)}
        />
      )}

      {/* A2 / B2: overwrite confirmation (single or batched) */}
      {conflictMonths && (
        <ConfirmDialog
          title={conflictMonths.length === 1 ? 'Data already exists' : `${conflictMonths.length} months already exist`}
          message={
            conflictMonths.length === 1
              ? `Data for ${conflictMonths[0].label} already exists. Overwrite?`
              : `${conflictMonths.map(c => c.label).join(', ')} — Overwrite all?`
          }
          items={conflictMonths.length > 1 ? conflictMonths.map(c => c.label) : undefined}
          confirmLabel={conflictMonths.length > 1 ? 'Overwrite All' : 'Overwrite'}
          onConfirm={() => importBatch(pendingBatch)}
          onCancel={() => { setConflictMonths(null); setPendingBatch([]); setSkippedFiles([]); setAppState(uploadedMonths.length > 0 ? 'dashboard' : 'upload'); }}
        />
      )}
    </div>
  );
}

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>('loading');
  const [managerRecords, setManagerRecords] = useState<AttendanceRecord[]>([]);

  useEffect(() => {
    const qp = new URLSearchParams(window.location.search);
    const isView = qp.get('view') === '1';
    if (isView) {
      const records = readSharedData();
      if (records && records.length > 0) { setManagerRecords(records); setViewMode('manager'); }
      else setViewMode('denied');
      return;
    }
    setViewMode('hr');
  }, []);

  if (viewMode === 'loading') return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-slate-500 text-sm">Loading...</div>
    </div>
  );
  if (viewMode === 'denied') return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
      <ShieldX className="w-12 h-12 text-red-400" />
      <p className="text-slate-400 text-sm">Access denied — shared link is invalid or expired.</p>
    </div>
  );
  if (viewMode === 'manager') return <ManagerView records={managerRecords} />;

  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-900 flex items-center justify-center"><div className="text-slate-500 text-sm">Loading...</div></div>}>
      <HRDashboard />
    </Suspense>
  );
}