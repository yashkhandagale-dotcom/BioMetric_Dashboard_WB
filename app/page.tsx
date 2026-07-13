'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Upload, CheckCircle, Eye, ShieldX, Calendar, Settings as SettingsIcon, X as XIcon, ArrowLeft } from 'lucide-react';
import { AttendanceRecord, ColumnMapping, EmployeeSummary, UploadedMonth, Holiday, Thresholds, LeaveRecord } from '@/lib/types';
import {
  getMapping, saveMapping, getRecords, saveRecords, addUploadedMonth, getUploadedMonths,
} from '@/lib/storage';
import { getThresholds, saveThresholds, DEFAULT_THRESHOLDS } from '@/lib/settings';
import { getLeaveRecords } from '@/lib/leaveStorage';
import { getAllKnownDepartments, loadEmployeeDirectory, useEmployeeDirectorySync } from '@/lib/employeeStore';
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

import EmployeeTable from '@/components/EmployeeTable';
import {
  DailyTrendChart, DeptAttendanceChart, HoursDistributionChart,
  DeptProductivityChart, ComparisonTrendChart,
  DayDeptAttendanceChart, DayDeptLateChart, DayDeptProductivityChart,
  OfficeAttendanceChart, AttendanceHeatmap
} from '@/components/Charts';
import ExportPanel from '@/components/ExportPanel';
import EmployeePanel from '@/components/EmployeePanel';
import EmployeeComparisonPanel from '@/components/EmployeeComparisonPanel';
import TeamComparisonPanel from '@/components/TeamComparisonPanel';
import HolidayModal from '@/components/HolidayModal';
import InsightsStrip from '@/components/InsightsStrip';
import SettingsPanel from '@/components/SettingsPanel';
import HRAbsenceChecker from '@/components/HRAbsenceChecker';

type AppState = 'upload' | 'mapping' | 'dashboard';
type ViewMode = 'loading' | 'hr' | 'manager' | 'denied';
interface Toast { type: 'success' | 'error'; message: string; }
interface PendingFile { file: File; officeCode: string; month: string; year: string; headerSignature: string; }
interface MappingQueueItem { officeCode: string; headers: string[]; headerSignature: string; }

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
      <header className="border-b border-slate-800 px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">WB</span>
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm">Attendance Dashboard</h1>
            <p className="text-slate-500 text-xs">WonderBiz Technologies · Management View</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg">
          <Eye className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
          <span className="text-slate-400 text-xs">Read-only · {records.length.toLocaleString()} records</span>
        </div>
      </header>
      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto space-y-6">
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

  const [pendingBatch, setPendingBatch] = useState<PendingFile[]>([]);
  const [skippedFiles, setSkippedFiles] = useState<{ name: string; reason: string }[]>([]);
  const [mappingQueue, setMappingQueue] = useState<MappingQueueItem[]>([]);
  // Resolved column mapping per (officeCode + header-signature) *for this batch only*.
  // Needed because column_mappings in the DB is keyed by office_code alone — if a
  // batch mixes two different header layouts for the same office (e.g. an older
  // month's export next to a reformatted one), saving a mapping for one overwrites
  // the other in the DB. Caching per-signature here means importBatch() uses the
  // mapping that was actually confirmed for THAT file's header shape, not whatever
  // happens to be sitting in the DB by the time import runs.
  const [batchMappings, setBatchMappings] = useState<Record<string, ColumnMapping>>({});
  const [remapInitial, setRemapInitial] = useState<Partial<ColumnMapping> | undefined>(undefined);
  const [conflictMonths, setConflictMonths] = useState<{ key: string; label: string }[] | null>(null);

  const [allRecords, setAllRecords] = useState<AttendanceRecord[]>([]);
  const [uploadedMonths, setUploadedMonths] = useState<UploadedMonth[]>([]);
  const [selectedMonthKey, setSelectedMonthKey] = useState('');
  const [selectedOffice, setSelectedOffice] = useState('ALL');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [tableFilter, setTableFilter] = useState<string>('all');
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);
  const [allOfficeRecords, setAllOfficeRecords] = useState<AttendanceRecord[]>([]);
  const [allUploadedRecords, setAllUploadedRecords] = useState<AttendanceRecord[]>([]);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);

  // Shared drill state: when DeptAttendanceChart drills to a dept,
  // DeptProductivityChart follows
  const [deptDrillSync, setDeptDrillSync] = useState<string | null>(null);

  useEffect(() => {
    getThresholds().then(setThresholds);
  }, []);

  // ── Employee directory (department overrides + deletions) ─────────────────
  // Loaded once from Supabase into an in-memory cache (lib/employeeStore.ts).
  // getRecords() applies it synchronously, so every chart/table/export is
  // already correct — this effect just needs to trigger a re-fetch whenever
  // the directory changes (initial load, or any reassignment/delete/restore).
  const directoryVersion = useEmployeeDirectorySync();

  useEffect(() => {
    loadEmployeeDirectory();
  }, []);

  useEffect(() => {
    refreshDepartmentOverrides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoryVersion]);

  useEffect(() => {
    if (!selectedMonthKey) return;
    let cancelled = false;
    const officeCode = getOfficeFromKey(selectedMonthKey);
    const year = getYearFromKey(selectedMonthKey);
    (async () => {
      const [h, l, months] = await Promise.all([
        getHolidays(officeCode, year),
        getLeaveRecords(selectedMonthKey),
        getUploadedMonths(),
      ]);
      if (cancelled) return;
      setHolidays(h);
      setLeaveRecords(l);
      const month = selectedMonthKey.split('_')[1];
      const sameMonth = months.filter(m => m.month === month && m.year === year);
      const officeRecs = (await Promise.all(sameMonth.map(m => getRecords(m.key)))).flat();
      if (cancelled) return;
      setAllOfficeRecords(officeRecs);
    })();
    return () => { cancelled = true; };
  }, [selectedMonthKey]);

  // All records across every uploaded month — re-fetched whenever the set of
  // uploaded months changes. This is ALWAYS the source of truth; the month
  // dropdown only controls which holidays/leaves/office context to load.
  useEffect(() => {
    if (uploadedMonths.length === 0) { setAllUploadedRecords([]); return; }
    let cancelled = false;
    Promise.all(uploadedMonths.map(m => getRecords(m.key))).then((recs) => {
      if (!cancelled) setAllUploadedRecords(recs.flat());
    });
    return () => { cancelled = true; };
  }, [uploadedMonths]);

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail as { officeCode: string; headers: string[]; mapping: ColumnMapping };
      setShowSettings(false);
      setMappingQueue([{ officeCode: detail.officeCode, headers: detail.headers, headerSignature: detail.headers.join('|') }]);
      setRemapInitial(detail.mapping);
      setAppState('mapping');
    }
    window.addEventListener('remap-headers', handler);
    return () => window.removeEventListener('remap-headers', handler);
  }, []);

  useEffect(() => {
    (async () => {
      const months = await getUploadedMonths();
      if (months.length === 0) return;
      setUploadedMonths(months);
      const monthParam = searchParams.get('month');
      const officeParam = searchParams.get('office');
      const deptParam = searchParams.get('dept');
      const matchMonth = months.find(m => m.key === monthParam) ?? months[months.length - 1];
      setSelectedMonthKey(matchMonth.key);
      setAllRecords(await getRecords(matchMonth.key));
      if (officeParam) setSelectedOffice(officeParam);
      if (deptParam) setSelectedDepts(deptParam.split(',').filter(Boolean));
      setAppState('dashboard');
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const syncURL = useCallback((monthKey: string, office: string, depts: string[]) => {
    const params = new URLSearchParams();
    if (monthKey) params.set('month', monthKey);
    if (office && office !== 'ALL') params.set('office', office);
    if (depts.length > 0) params.set('dept', depts.join(','));
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '/', { scroll: false });
  }, [router]);

  async function handleSignOut() {
    await fetch('/api/auth/signout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  function showToast(type: Toast['type'], message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 6000);
  }

  async function handleFiles(files: File[]) {
    const valid: PendingFile[] = [];
    const skipped: { name: string; reason: string }[] = [];

    for (const file of files) {
      const result = validateFile(file);
      if (!result.valid) {
        skipped.push({ name: file.name, reason: result.error || 'Invalid file' });
        continue;
      }
      const headers = await parseCSVHeaders(file);
      valid.push({ file, officeCode: result.officeCode!, month: result.month!, year: result.year!, headerSignature: headers.join('|') });
    }
    setSkippedFiles(skipped);

    if (valid.length === 0) {
      if (skipped.length > 0) {
        showToast('error', `No files imported. ${skipped.length} skipped: ${skipped.map(s => `${s.name} (${s.reason.split('\n')[0]})`).join('; ')}`);
      }
      return;
    }

    setPendingBatch(valid);

    const queue: MappingQueueItem[] = [];
    const resolved: Record<string, ColumnMapping> = {};
    // A batch can contain several files for the same office whose export
    // format differs between months (e.g. an older layout next to a
    // reformatted one). column_mappings in the DB is keyed by office_code
    // alone, so it can only remember ONE mapping per office at a time — it
    // is not a reliable source of truth for every file in a mixed-format
    // batch. Check EVERY file's own headers here (not just the first file
    // seen per office), and cache a resolved mapping per (office +
    // header-signature) so files sharing the same header layout only need
    // to be checked/resolved once, while a different layout for the same
    // office still gets its own check.
    const seenSignatures = new Set<string>();
    for (const pf of valid) {
      const sigKey = `${pf.officeCode}::${pf.headerSignature}`;
      if (seenSignatures.has(sigKey)) continue;
      seenSignatures.add(sigKey);

      const headers = pf.headerSignature.split('|');
      const existingMapping = await getMapping(pf.officeCode);
      if (!existingMapping) {
        queue.push({ officeCode: pf.officeCode, headers, headerSignature: pf.headerSignature });
        continue;
      }
      // The office has a saved mapping, but it may point to header names
      // from a DIFFERENT file's layout than this one. If this file's
      // headers don't contain every mapped column, row[mapping.xxx]
      // lookups return undefined for every row, silently producing
      // "0 rows parsed" — or worse, garbage if it partially matches.
      // Force a remap for this header shape instead of a silent no-op.
      const missingHeaders = Object.values(existingMapping).filter(h => h && !headers.includes(h));
      if (missingHeaders.length > 0) {
        queue.push({ officeCode: pf.officeCode, headers, headerSignature: pf.headerSignature });
      } else {
        // This file's headers already match the saved mapping exactly —
        // reuse it for this signature without prompting the user again.
        resolved[sigKey] = existingMapping;
      }
    }
    if (Object.keys(resolved).length > 0) setBatchMappings((prev) => ({ ...prev, ...resolved }));

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
    await saveMapping(current.officeCode, mapping);
    setBatchMappings((prev) => ({ ...prev, [`${current.officeCode}::${current.headerSignature}`]: mapping }));

    const remaining = mappingQueue.slice(1);
    if (remaining.length > 0) {
      setMappingQueue(remaining);
      setRemapInitial(undefined);
      return;
    }

    setMappingQueue([]);
    setRemapInitial(undefined);

    if (remapInitial !== undefined && pendingBatch.length === 0) {
      setAppState('dashboard');
      showToast('success', `Column mapping updated for ${current.officeCode}.`);
      return;
    }

    await proceedToConflictCheck(pendingBatch);
  }

  async function proceedToConflictCheck(batch: PendingFile[]) {
    const months = await getUploadedMonths();
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
      const sigKey = `${pf.officeCode}::${pf.headerSignature}`;
      const mapping = batchMappings[sigKey] ?? await getMapping(pf.officeCode);
      if (!mapping) continue;
      const { records, duplicatesSkipped, missingCodeOrDate, uniqueEmployeeCodes } =
        await parseCSVWithMapping(pf.file, mapping, pf.officeCode, thresholds.graceMinutes);
      const totalRowsSeen = records.length + duplicatesSkipped + missingCodeOrDate;

      if (records.length === 0) {
        // A non-empty CSV that parsed to zero rows almost always means the
        // saved column mapping no longer matches this file's headers (or
        // every row is missing an employee code / date). Surface this
        // loudly instead of silently reporting "0 new, 0 updated" as if
        // nothing was wrong.
        results.push(`${pf.officeCode} ${getMonthName(pf.month)} ${pf.year}: 0 rows parsed — check column mapping in Settings, the file's columns may not match what's expected.`);
        continue;
      }

      // Rows silently dropped for a blank mapped Employee Code / Date cell.
      // If a large share of the file falls into this bucket, the mapping
      // most likely points at the wrong column for one of those two fields
      // (rather than the source data genuinely having that many blank rows).
      const missingRatio = totalRowsSeen > 0 ? missingCodeOrDate / totalRowsSeen : 0;
      if (missingCodeOrDate > 0 && missingRatio > 0.1) {
        results.push(
          `${pf.officeCode} ${getMonthName(pf.month)} ${pf.year}: ${missingCodeOrDate} of ${totalRowsSeen} rows ` +
          `(${Math.round(missingRatio * 100)}%) were skipped for a blank Employee Code or Date — ` +
          `check that those fields are mapped to the right columns in Settings. Skipped this file.`
        );
        continue;
      }

      // Many rows collapsing onto the same (employee, date) key almost
      // always means "Employee Code" is mapped to a low-cardinality column
      // (e.g. Department/Shift) instead of the real per-person ID — dozens
      // of distinct employees quietly overwrite each other under a handful
      // of shared codes, and the dashboard ends up showing far fewer
      // employees than were actually in the file, with no error shown.
      const dupeRatio = (records.length + duplicatesSkipped) > 0
        ? duplicatesSkipped / (records.length + duplicatesSkipped) : 0;
      if (duplicatesSkipped > 0 && dupeRatio > 0.15) {
        results.push(
          `${pf.officeCode} ${getMonthName(pf.month)} ${pf.year}: ${duplicatesSkipped} rows collapsed as duplicates, ` +
          `leaving only ${uniqueEmployeeCodes} distinct employee code(s) from ${records.length + duplicatesSkipped} attempted rows — ` +
          `"Employee Code" is likely mapped to the wrong column. Skipped this file; please re-check column mapping in Settings.`
        );
        continue;
      }

      // A wrong-but-not-empty column mapping (e.g. the saved mapping's raw
      // header strings don't quite match this file's headers — different
      // whitespace, a renamed column, a reordered export) can still parse
      // a non-zero row count while silently pulling data from the wrong
      // columns: blank employee names, department collapsing to 'Unknown'
      // for most rows, or every row getting stuck on one status. That's
      // corrupted data with no error shown, which is worse than 0 rows.
      // Catch the common patterns here and force a remap instead of
      // quietly writing garbage into attendance_records.
      const blankNameCount = records.filter(r => !r.employeeName).length;
      const unknownDeptCount = records.filter(r => r.department === 'Unknown').length;
      const blankNameRatio = blankNameCount / records.length;
      const unknownDeptRatio = unknownDeptCount / records.length;
      if (blankNameRatio > 0.2 || unknownDeptRatio > 0.2) {
        results.push(
          `${pf.officeCode} ${getMonthName(pf.month)} ${pf.year}: parsed ${records.length} rows but ` +
          `${Math.round(blankNameRatio * 100)}% have a blank employee name and ${Math.round(unknownDeptRatio * 100)}% have an unrecognized department — ` +
          `this file's columns likely don't match the saved mapping. Skipped; please re-check column mapping in Settings.`
        );
        continue;
      }
      const monthKey = `${pf.year}_${pf.month}_${pf.officeCode}`;
      const monthLabel = `${pf.officeCode} \u2014 ${getMonthName(pf.month)} ${pf.year}`;
      // NOTE: uploaded_months row must exist BEFORE attendance_records rows,
      // since attendance_records.month_key has a foreign key referencing
      // uploaded_months.key. Creating it first avoids a 409/23503 FK violation.
      await addUploadedMonth({ key: monthKey, label: monthLabel, officeCode: pf.officeCode, month: pf.month, year: pf.year });
      const { added, updated } = await saveRecords(monthKey, records);
      lastMonthKey = monthKey;
      // Even when below the warning thresholds above, never let skipped
      // rows go completely unmentioned — a small, genuinely-blank-row count
      // is normal, but HR should still be able to see it happened.
      const skippedNote = (missingCodeOrDate > 0 || duplicatesSkipped > 0)
        ? ` — ${missingCodeOrDate} row(s) skipped (missing code/date), ${duplicatesSkipped} duplicate row(s) skipped`
        : '';
      results.push(`${pf.officeCode} ${getMonthName(pf.month)} ${pf.year} (${added} new, ${updated} updated)${skippedNote}`);
    }

    const months = await getUploadedMonths();
    setUploadedMonths(months);
    if (lastMonthKey) {
      setAllRecords(await getRecords(lastMonthKey));
      setSelectedMonthKey(lastMonthKey);
      syncURL(lastMonthKey, 'ALL', []);
    }
    setSelectedOffice('ALL');
    setSelectedDepts([]);
    setTableFilter('all');
    // Bug fix: previously dateFrom/dateTo were left as-is after a re-upload
    // or overwrite, so a date range picked before the upload (e.g. a single
    // day, or a range confined to the old data) stayed stuck in the picker
    // and silently constrained the min/max of the date inputs — making it
    // look like new dates couldn't be selected even though fresh months had
    // just been imported. Reset the range here, same as handleMonthChange.
    setDateFrom(null);
    setDateTo(null);
    setDeptDrillSync(null);
    setAppState('dashboard');
    setPendingBatch([]);
    setBatchMappings({});

    const skipNote = skippedFiles.length > 0
      ? ` ${skippedFiles.length} file skipped: ${skippedFiles.map(s => `'${s.name}' (${s.reason.split('\n')[0]})`).join(', ')}.`
      : '';
    showToast('success', `Imported ${batch.length} file${batch.length > 1 ? 's' : ''}: ${results.join(', ')}.${skipNote}`);
    setSkippedFiles([]);
  }

  async function handleMonthChange(key: string) {
    setSelectedMonthKey(key);
    setAllRecords(await getRecords(key));
    setSelectedOffice('ALL');
    setSelectedDepts([]);
    setTableFilter('all');
    setDateFrom(null);
    setDateTo(null);
    setDeptDrillSync(null);
    syncURL(key, 'ALL', []);
  }

  function handleOfficeChange(o: string) {
    setSelectedOffice(o);
    syncURL(selectedMonthKey, o, selectedDepts);
  }

  function focusDept(d: string) {
    setSelectedDepts([d]);
    setTableFilter('all');
    syncURL(selectedMonthKey, selectedOffice, [d]);
  }

  function toggleDept(d: string) {
    const next = selectedDepts.includes(d) ? selectedDepts.filter(x => x !== d) : [...selectedDepts, d];
    setSelectedDepts(next);
    syncURL(selectedMonthKey, selectedOffice, next);
  }

  function clearDepts() {
    setSelectedDepts([]);
    setTableFilter('all');
    setDeptDrillSync(null);
    syncURL(selectedMonthKey, selectedOffice, []);
  }

  async function refreshLeaveRecords() {
    if (selectedMonthKey) setLeaveRecords(await getLeaveRecords(selectedMonthKey));
  }

  async function refreshDepartmentOverrides() {
    // Full re-fetch (not an incremental merge) — necessary because a deleted
    // employee needs their records actually REMOVED from the pool, which a
    // merge-by-key update can't do (it only ever adds/updates keys, never
    // drops ones that no longer come back from getRecords()).
    const uRecs = (await Promise.all(uploadedMonths.map(m => getRecords(m.key)))).flat();
    setAllUploadedRecords(uRecs);

    if (!selectedMonthKey) return;
    setAllRecords(await getRecords(selectedMonthKey));

    const officeCode = getOfficeFromKey(selectedMonthKey);
    const year = getYearFromKey(selectedMonthKey);
    const months = await getUploadedMonths();
    const month = selectedMonthKey.split('_')[1];
    const sameMonth = months.filter(m => m.month === month && m.year === year);
    const officeRecs = (await Promise.all(sameMonth.map(m => getRecords(m.key)))).flat();
    setAllOfficeRecords(officeRecs);
  }


  async function handleSaveThresholds(t: Thresholds) {
    await saveThresholds(t);
    setThresholds(t);
    showToast('success', 'Thresholds updated.');
  }

  // All uploaded records across ALL months — this is ALWAYS the source of truth.
  // The month dropdown only controls which holidays/leaves/office context to load.
  // The date range (dateFrom/dateTo) windows into this pool.
  // When no date range is set, we default to showing only the selected month's records
  // so the default view still feels "per month" without requiring the user to set dates.
  // (allUploadedRecords is populated by the useEffect above, keyed off uploadedMonths.)

  // Effective record pool for the dashboard:
  // - If user has set a date range → use all records across all months (cross-month support)
  // - If no date range → use only the selected month's records (default per-month view)
  const recordPool = (dateFrom || dateTo) ? allUploadedRecords : allRecords;

  const { kpi, employeeSummaries, dailyTrend, deptAttendance, hoursDistribution, officeAttendance, departments, offices, filteredRecords, availableDates, viewMode, dayDeptSnapshots } =
    useDashboardData(recordPool, selectedOffice, selectedDepts, [], holidays, thresholds, leaveRecords, allOfficeRecords, dateFrom, dateTo);

  // Comparison mode (2+ departments selected) needs the FULL department
  // universe — not just the selected ones — so the bar charts below can show
  // every department and simply dim the ones outside the comparison set,
  // rather than only ever showing the selected departments in isolation.
  const { deptAttendance: allDeptAttendance, filteredRecords: allDeptRecords } =
    useDashboardData(recordPool, selectedOffice, [], [], holidays, thresholds, leaveRecords, allOfficeRecords, dateFrom, dateTo);

  const isComparison = viewMode === 'comparison';

  const leaveMap = buildLeaveMap(leaveRecords);

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

  // All dates across ALL uploaded months (for cross-month date range).
  // Sorted chronologically (by actual Date value), not lexically as strings —
  // a plain string sort breaks across month boundaries whenever a date isn't
  // strict ISO "YYYY-MM-DD" (e.g. "31-05-2026" would out-sort "30-06-2026").
  const allAvailableDates = (() => {
    const set = new Set<string>();
    allUploadedRecords.forEach(r => set.add(r.date));
    return Array.from(set).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  })();
  const minAvailableDate = allAvailableDates[0];
  const maxAvailableDate = allAvailableDates[allAvailableDates.length - 1];

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {toast && (
        <div className={`fixed top-4 right-4 left-4 sm:left-auto z-50 flex items-start gap-3 sm:max-w-md px-4 py-3 rounded-xl shadow-2xl border
          ${toast.type === 'success' ? 'bg-emerald-900/90 border-emerald-500/40 text-emerald-200' : 'bg-red-900/90 border-red-500/40 text-red-200'}`}>
          <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{toast.message}</p>
        </div>
      )}

      <header className="border-b border-slate-800 px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">WB</span>
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm">Attendance Dashboard</h1>
            <p className="text-slate-500 text-xs">WonderBiz Technologies · HR View</p>
          </div>
        </div>
        {appState === 'dashboard' && (
          <div className="flex items-center gap-2 flex-wrap">
            {holidays.length > 0 && (
              <button
                onClick={() => setShowHolidayModal(true)}
                className="flex items-center gap-1.5 bg-purple-600/20 border border-purple-500/30 text-purple-400 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-purple-600/30 transition-colors"
              >
                <Calendar className="w-3.5 h-3.5" />
                🗓 {holidays.length} Holiday{holidays.length !== 1 ? 's' : ''}
              </button>
            )}
            {holidays.length === 0 && currentOffice && (
              <button
                onClick={() => setShowHolidayModal(true)}
                className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 px-2 py-1.5 rounded-lg text-xs transition-colors"
                title="Manage holidays"
              >
                <Calendar className="w-3.5 h-3.5" /> Holidays
              </button>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 px-2 py-1.5 rounded-lg text-xs transition-colors"
              title="Settings"
            >
              <SettingsIcon className="w-3.5 h-3.5" /> Settings
            </button>
            <ExportPanel uploadedMonths={uploadedMonths} thresholds={thresholds} />
            <button onClick={() => setAppState('upload')}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <Upload className="w-4 h-4" /> Upload CSV
            </button>
            <button onClick={handleSignOut}
              className="text-slate-500 hover:text-slate-300 px-2 py-1.5 rounded-lg text-xs transition-colors">
              Sign out
            </button>
          </div>
        )}
      </header>

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {appState === 'upload' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <button
                onClick={() => setAppState('dashboard')}
                className="inline-flex items-center gap-2 text-slate-300 hover:text-white bg-slate-800/70 border border-slate-700 px-3 py-2 rounded-lg text-sm transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to dashboard
              </button>
              <div className="text-slate-400 text-xs">Upload one or more biometric export CSVs to get started</div>
            </div>
            <UploadZone onFiles={handleFiles} />
          </div>
        )}
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

            {/* ── HR Absence Checker ─────────────────────────────────────── */}
            <HRAbsenceChecker allUploadedRecords={allUploadedRecords} />

            {/* ── Filter Bar ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Date range — restricted to the span of dates actually present in uploaded data */}
              {allAvailableDates.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-1.5">
                  <span className="text-slate-500 text-xs font-medium">From</span>
                  <input
                    type="date"
                    value={dateFrom ?? ''}
                    min={minAvailableDate}
                    max={dateTo ?? maxAvailableDate}
                    onChange={e => {
                      const v = e.target.value || null;
                      if (v && (v < minAvailableDate! || v > maxAvailableDate!)) {
                        showToast('error', `No data outside ${minAvailableDate} → ${maxAvailableDate}.`);
                        return;
                      }
                      setDateFrom(v);
                      // Auto-set To = From for single-day selection if To not set
                      if (v && !dateTo) setDateTo(v);
                      // If From > To, reset To
                      if (v && dateTo && v > dateTo) setDateTo(v);
                    }}
                    className="bg-transparent text-white text-xs focus:outline-none w-28 sm:w-32"
                  />
                  <span className="text-slate-600 text-xs">→</span>
                  <span className="text-slate-500 text-xs font-medium">To</span>
                  <input
                    type="date"
                    value={dateTo ?? ''}
                    min={dateFrom ?? minAvailableDate}
                    max={maxAvailableDate}
                    onChange={e => {
                      const v = e.target.value || null;
                      if (v && (v < minAvailableDate! || v > maxAvailableDate!)) {
                        showToast('error', `No data outside ${minAvailableDate} → ${maxAvailableDate}.`);
                        return;
                      }
                      setDateTo(v);
                      // Auto-set From = To for single-day selection if From not set
                      if (v && !dateFrom) setDateFrom(v);
                    }}
                    className="bg-transparent text-white text-xs focus:outline-none w-28 sm:w-32"
                  />
                  {(dateFrom || dateTo) && (
                    <button onClick={() => { setDateFrom(null); setDateTo(null); }} className="text-slate-500 hover:text-white transition-colors ml-1" title="Clear date range">
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* Office pills */}
              <div className="flex gap-1">
                {['ALL', ...offices].map(o => (
                  <button key={o} onClick={() => handleOfficeChange(o)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedOffice === o ? 'bg-blue-600 text-white' : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    {o}
                  </button>
                ))}
              </div>

              {/* Department pills */}
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

            {/* ── Active filter banner ───────────────────────────────────── */}
            {(dateFrom || dateTo) && (
              <div className={`flex items-center gap-3 rounded-xl px-4 py-2.5 border
                ${viewMode === 'single_day'
                  ? 'bg-blue-500/10 border-blue-500/25'
                  : 'bg-indigo-500/10 border-indigo-500/25'}`}>
                <Calendar className={`w-4 h-4 flex-shrink-0 ${viewMode === 'single_day' ? 'text-blue-400' : 'text-indigo-400'}`} />
                <div className="flex-1 min-w-0">
                  {viewMode === 'single_day' ? (
                    <span className="text-blue-300 text-sm font-medium">
                      Day view: {new Date((dateFrom ?? '') + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      <span className="text-blue-400/60 text-xs ml-2">— KPIs show raw counts, charts show dept snapshots</span>
                    </span>
                  ) : (
                    <span className="text-indigo-300 text-sm font-medium">
                      Range: {dateFrom} → {dateTo}
                      <span className="text-indigo-400/60 text-xs ml-2">— {filteredRecords.length.toLocaleString()} records</span>
                    </span>
                  )}
                </div>
                <button onClick={() => { setDateFrom(null); setDateTo(null); }} className="text-slate-400/60 hover:text-white transition-colors flex-shrink-0">
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* ── KPI Cards ──────────────────────────────────────────────── */}
            <KPICards kpi={kpi} thresholds={thresholds} viewMode={viewMode} onCardClick={(f) => setTableFilter(f === tableFilter ? 'all' : f)} />



            {/* ── SINGLE DAY VIEW ─────────────────────────────────────────── */}
            {viewMode === 'single_day' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                  <DayDeptAttendanceChart
                    data={dayDeptSnapshots}
                    onDeptClick={(dept) => focusDept(dept)}
                    allRecords={filteredRecords}
                  />
                  <DayDeptLateChart
                    data={dayDeptSnapshots}
                    onDeptClick={(dept) => focusDept(dept)}
                    allRecords={filteredRecords}
                  />
                  <DayDeptProductivityChart
                    data={dayDeptSnapshots}
                    onDeptClick={(dept) => focusDept(dept)}
                    allRecords={filteredRecords}
                  />
                </div>
                <div className="bg-slate-800/30 rounded-xl border border-slate-700 p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                    <h2 className="text-white font-semibold text-sm">
                      {selectedDepts.length === 1 ? `Team Members — ${selectedDepts[0]}` : `All Employees — ${dateFrom}`}
                      {tableFilter !== 'all' && (
                        <span className="ml-2 text-xs text-slate-400 font-normal">
                          · filtered by <span className="text-blue-400 capitalize">{tableFilter}</span>
                          <button onClick={() => setTableFilter('all')} className="ml-2 text-slate-600 hover:text-slate-300">✕</button>
                        </span>
                      )}
                      {selectedDepts.length === 1 && (
                        <button onClick={clearDepts} className="ml-2 text-slate-600 hover:text-slate-300">✕</button>
                      )}
                    </h2>
                    <span className="text-slate-500 text-xs">{filteredSummaries.length} employees</span>
                  </div>
                  <EmployeeTable summaries={filteredSummaries} onEmployeeClick={setSelectedEmp} />
                </div>
              </>
            )}

            {/* ── MONTHLY / RANGE / COMPARISON VIEW ───────────────────────── */}
            {viewMode !== 'single_day' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  {isComparison ? (
                    <ComparisonTrendChart
                      records={filteredRecords}
                      selectedDepts={selectedDepts}
                      holidays={holidays}
                      graceMinutes={thresholds.graceMinutes}
                    />
                  ) : (
                    <DailyTrendChart
                      data={dailyTrend}
                      selectedDepts={selectedDepts}
                    />
                  )}
                  <HoursDistributionChart
                    data={hoursDistribution}
                    allRecords={filteredRecords}
                    selectedDepts={selectedDepts}
                  />
                </div>

                {/* Dept Attendance + Productivity Lost side by side, linked drill.
                    In comparison mode, show every department (dimming those not
                    selected) rather than only the selected ones. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  <DeptAttendanceChart
                    data={isComparison ? allDeptAttendance : deptAttendance}
                    allRecords={isComparison ? allDeptRecords : filteredRecords}
                    selectedDepts={selectedDepts}
                    highlightDepts={isComparison ? selectedDepts : undefined}
                    onDeptClick={(dept) => toggleDept(dept)}
                    onDeptDrillChange={(dept) => setDeptDrillSync(dept)}
                  />
                  <DeptProductivityChart
                    data={isComparison ? allDeptAttendance : deptAttendance}
                    allRecords={isComparison ? allDeptRecords : filteredRecords}
                    selectedDepts={selectedDepts}
                    highlightDepts={isComparison ? selectedDepts : undefined}
                    externalDrillDept={deptDrillSync}
                    onDrillBack={() => setDeptDrillSync(null)}
                    onDeptDrillChange={(dept) => setDeptDrillSync(dept)}
                    onDeptClick={(dept) => toggleDept(dept)}
                  />
                </div>

                {/* Office-wise attendance comparison — only meaningful across 2+ offices */}
                {offices.length > 1 && (
                  <OfficeAttendanceChart
                    data={officeAttendance}
                    onOfficeClick={(office) => handleOfficeChange(office === selectedOffice ? 'ALL' : office)}
                  />
                )}

                {/* Company-wide attendance heatmap (employee × date grid) */}
                {filteredRecords.length > 0 && (
                  <AttendanceHeatmap
                    records={filteredRecords}
                    onCellClick={(empCode) => {
                      const emp = employeeSummaries.find(e => e.employeeCode === empCode);
                      if (emp) setSelectedEmp(emp);
                    }}
                  />
                )}

                {isComparison && departments.length >= 2 && (
                  <TeamComparisonPanel allRecords={filteredRecords} departments={departments} />
                )}

                <EmployeeComparisonPanel
                  allRecords={filteredRecords}
                  employeeSummaries={employeeSummaries}
                  leaveRecords={leaveRecords}
                  holidays={holidays}
                  graceMinutes={thresholds.graceMinutes}
                  shiftStartMinutes={thresholds.shiftStartMinutes}
                  shiftEndMinutes={thresholds.shiftEndMinutes}
                />
                <InsightsStrip summaries={employeeSummaries} dailyTrend={dailyTrend} deptAttendance={deptAttendance} records={filteredRecords} selectedDepts={selectedDepts} />
                <div className="bg-slate-800/30 rounded-xl border border-slate-700 p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
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
              </>
            )}
          </div>
        )}
      </main>

      <EmployeePanel
        employee={selectedEmp}
        onClose={() => setSelectedEmp(null)}
        holidays={holidays}
        graceMinutes={thresholds.graceMinutes}
        monthKey={selectedMonthKey}
        leaveMap={leaveMap}
        onLeaveChange={refreshLeaveRecords}
        allDepartments={getAllKnownDepartments(allUploadedRecords)}
        onDepartmentChange={refreshDepartmentOverrides}
      />

      {showHolidayModal && (
        <HolidayModal
          officeCode={currentOffice}
          year={currentYear}
          onClose={() => setShowHolidayModal(false)}
          onSaved={(h) => setHolidays(h)}
        />
      )}

      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          thresholds={thresholds}
          onSaveThresholds={handleSaveThresholds}
          records={filteredRecords}
        />
      )}

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
      (async () => {
        const records = await readSharedData();
        if (records && records.length > 0) { setManagerRecords(records); setViewMode('manager'); }
        else setViewMode('denied');
      })();
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
//page.tsx