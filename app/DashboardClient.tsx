'use client';
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle, ShieldX, Calendar, X as XIcon } from 'lucide-react';
import { AttendanceRecord, ColumnMapping, EmployeeSummary, UploadedMonth, Holiday, Thresholds, LeaveRecord } from '@/lib/types';
import {
  getMapping, saveMapping, getRecords, saveRecords, addUploadedMonth, getUploadedMonths,
} from '@/lib/storage';
import { getThresholds, saveThresholds, DEFAULT_THRESHOLDS } from '@/lib/settings';
import { getAllLeaveRecords, getLeaveRecords, lookupLeavesForItems } from '@/lib/leaveTrackerRead';
import { getAllKnownDepartments, loadEmployeeDirectory, useEmployeeDirectorySync } from '@/lib/employeeStore';
import { buildLeaveMap, isAbsent } from '@/lib/useDashboardData';
import { parseCSVHeaders, parseCSVWithMapping } from '@/lib/parseCSV';
import { validateFile } from '@/lib/validateFile';
import { readSharedData } from '@/lib/sharedLink';
import { useDashboardData } from '@/lib/useDashboardData';
import { getHolidays } from '@/lib/holidays';
import UploadZone from '@/components/UploadZone';
import ColumnMappingScreen from '@/components/ColumnMappingScreen';
import ConfirmDialog from '@/components/ConfirmDialog';
import KPICards from '@/components/KPICards';
import OnLeaveTodayCard from '@/components/OnLeaveTodayCard';

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
import DashboardShell, { type DashboardSectionId } from '@/components/dashboard/DashboardShell';
import DashboardSkeleton from '@/components/dashboard/DashboardSkeleton';

// 'loading' is the initial render only — it exists so a login/refresh
// never flashes the upload screen while we're still checking whether
// data already exists. It's never re-entered after the initial fetch:
// once we know the answer, we settle into 'upload' (genuinely empty)
// or 'dashboard' (months found) and stay within {upload, mapping,
// dashboard} for the rest of the session.
type AppState = 'loading' | 'upload' | 'mapping' | 'dashboard';

// Single-login pivot: 'team' is new — an authenticated manager/lead
// hitting '/' directly (not via the legacy unauthenticated share-link
// token, which stays 'manager'/'denied' exactly as before). Kept as a
// distinct mode from 'manager' rather than reusing it because 'team'
// needs to fetch its own records (the share-link flow gets records
// handed to it already decoded) and gets extra nav buttons the
// share-link view intentionally doesn't have (a stranger with a token
// isn't logged in and has nowhere else in the app to navigate to).
type ViewMode = 'loading' | 'hr' | 'manager' | 'team' | 'denied';
interface Toast { type: 'success' | 'error'; message: string; }
interface PendingFile { file: File; officeCode: string; month: string; year: string; }
interface MappingQueueItem { officeCode: string; headers: string[]; }

function getMonthName(mm: string): string {
  const m = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
// Single-login pivot: now serves two callers. The legacy unauthenticated
// share-link view (?view=1&token=...) passes only `records` — unchanged
// behavior, company-wide, no nav buttons (a stranger with a token isn't
// logged into anything else in the app). An authenticated manager/lead
// landing on '/' directly now also renders this, via the `teamMode` prop:
// same read-only component, but `records` has already been filtered to
// their team by the caller (see Home below), the header says "Team View"
// instead of "Management View", and it gets buttons back to their own
// leave page / approval queue instead of nothing.
type DatePreset = 'all' | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'custom';

function formatYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDateRangeForPreset(preset: DatePreset): { from: string | null; to: string | null } {
  const now = new Date();
  if (preset === 'today') {
    const s = formatYMD(now);
    return { from: s, to: s };
  }
  if (preset === 'yesterday') {
    const y = new Date(now.getTime() - 86400000);
    const s = formatYMD(y);
    return { from: s, to: s };
  }
  if (preset === 'this_week') {
    const day = now.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    return { from: formatYMD(monday), to: formatYMD(now) };
  }
  if (preset === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: formatYMD(start), to: formatYMD(now) };
  }
  if (preset === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: formatYMD(start), to: formatYMD(end) };
  }
  return { from: null, to: null };
}

function ManagerView({
  records,
  teamMode,
  teamCodes,
  managedDepartments,
}: {
  records: AttendanceRecord[];
  teamMode?: boolean;
  teamCodes?: string[];
  managedDepartments?: string[];
}) {
  const [selectedEmp, setSelectedEmp] = useState<EmployeeSummary | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [uploadedMonths, setUploadedMonths] = useState<UploadedMonth[]>([]);

  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);

  // Filtering states
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');

  useEffect(() => {
    getThresholds().then(setThresholds);
  }, []);

  useEffect(() => {
    if (!teamMode) return;
    getUploadedMonths().then(setUploadedMonths);
  }, [teamMode]);

  useEffect(() => {
    if (!records || records.length === 0) return;
    const monthKeys = Array.from(new Set(records.map((r) => `${r.date.slice(0, 4)}_${r.date.slice(5, 7)}_${r.officeCode}`)));
    if (monthKeys.length === 0) return;
    getAllLeaveRecords(monthKeys).then(setLeaveRecords).catch(() => {});
  }, [records]);

  const leaveMap = useMemo(() => buildLeaveMap(leaveRecords), [leaveRecords]);

  const availableTeams = useMemo(() => {
    if (managedDepartments && managedDepartments.length > 0) {
      return managedDepartments;
    }
    return Array.from(new Set(records.map((r) => r.department).filter(Boolean))).sort();
  }, [managedDepartments, records]);

  const effectiveDateRange = useMemo(() => {
    if (datePreset === 'custom') {
      return { from: customFrom || null, to: customTo || null };
    }
    return getDateRangeForPreset(datePreset);
  }, [datePreset, customFrom, customTo]);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (selectedTeam !== 'all' && r.department !== selectedTeam) {
        return false;
      }
      if (effectiveDateRange.from && r.date < effectiveDateRange.from) {
        return false;
      }
      if (effectiveDateRange.to && r.date > effectiveDateRange.to) {
        return false;
      }
      return true;
    });
  }, [records, selectedTeam, effectiveDateRange]);

  const { kpi, employeeSummaries, dailyTrend, deptAttendance, hoursDistribution } =
    useDashboardData(filteredRecords, 'ALL', [], [], [], thresholds, leaveRecords);

  const teamDepartments = teamMode
    ? selectedTeam !== 'all'
      ? [selectedTeam]
      : Array.from(new Set(filteredRecords.map((r) => r.department).filter(Boolean)))
    : [];

  const isFilterActive = selectedTeam !== 'all' || datePreset !== 'all' || Boolean(customFrom) || Boolean(customTo);

  function resetFilters() {
    setSelectedTeam('all');
    setDatePreset('all');
    setCustomFrom('');
    setCustomTo('');
  }

  const PRESETS: { key: DatePreset; label: string }[] = [
    { key: 'all', label: 'All Time' },
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'this_week', label: 'This Week' },
    { key: 'this_month', label: 'This Month' },
    { key: 'last_month', label: 'Last Month' },
    { key: 'custom', label: 'Custom Range' },
  ];

  return (
    <DashboardShell
      variant={teamMode ? 'team' : 'shared'}
      availableSections={['overview', 'employees', 'departments']}
      recordCount={filteredRecords.length}
      exportSlot={teamMode ? <ExportPanel uploadedMonths={uploadedMonths} thresholds={thresholds} restrictToEmployeeCodes={teamCodes ?? []} /> : undefined}
    >
      <div className="space-y-6">
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-blue-300 flex items-center justify-between flex-wrap gap-2">
          <span>
            {teamMode
              ? "Read-only view, scoped to your team hierarchy — upload and settings aren't available here, but you can export."
              : 'Read-only view — upload, export and settings are not available here.'}
          </span>
          {isFilterActive && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-800 dark:text-blue-200">
              Showing {filteredRecords.length} of {records.length} records
            </span>
          )}
        </div>

        {/* ── Team & Date Filter Bar ────────────────────────────────────────── */}
        <div className="bg-[var(--bg-elevated)]/60 border border-[var(--border)] rounded-2xl p-4 shadow-sm space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Team Filter */}
              {availableTeams.length > 0 && (
                <div className="flex items-center gap-2">
                  <label htmlFor="team-select" className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                    Team:
                  </label>
                  <select
                    id="team-select"
                    value={selectedTeam}
                    onChange={(e) => setSelectedTeam(e.target.value)}
                    className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                  >
                    <option value="all">All Teams ({availableTeams.length})</option>
                    {availableTeams.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Date Presets */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mr-1">
                  Duration:
                </span>
                <div className="flex items-center gap-1 bg-[var(--bg-surface)] p-1 rounded-xl border border-[var(--border)] flex-wrap">
                  {PRESETS.map((p) => {
                    const active = datePreset === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setDatePreset(p.key)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                          active
                            ? 'bg-[var(--accent)] text-white shadow-xs'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {isFilterActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Reset Filters
              </button>
            )}
          </div>

          {/* Custom Date Range Inputs */}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-subtle)] flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--text-muted)] font-medium">From:</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--text-muted)] font-medium">To:</label>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                />
              </div>
            </div>
          )}
        </div>

        <div id="section-overview" className="space-y-6">
          <KPICards kpi={kpi} thresholds={thresholds} />
          <OnLeaveTodayCard />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <DailyTrendChart data={dailyTrend} />
            <HoursDistributionChart data={hoursDistribution} allRecords={filteredRecords} />
          </div>
        </div>
        <div id="section-departments">
          <DeptAttendanceChart
            data={deptAttendance}
            allRecords={filteredRecords}
            selectedDepts={teamDepartments.length === 1 ? teamDepartments : undefined}
          />
        </div>
        <div id="section-employees" className="bg-[var(--bg-elevated)]/30 rounded-xl border border-[var(--border)] p-4">
          <h2 className="text-[var(--text-primary)] font-semibold text-sm mb-4">Employee Summary</h2>
          <EmployeeTable summaries={employeeSummaries} onEmployeeClick={setSelectedEmp} />
        </div>
      </div>
      <EmployeePanel
        employee={selectedEmp}
        onClose={() => setSelectedEmp(null)}
        readOnly
        graceMinutes={thresholds.graceMinutes}
        shiftStartMinutes={thresholds.shiftStartMinutes}
        shiftEndMinutes={thresholds.shiftEndMinutes}
        leaveMap={leaveMap}
      />
    </DashboardShell>
  );
}

// ── HR Dashboard inner ────────────────────────────────────────────────────────
function HRDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [appState, setAppState] = useState<AppState>('loading');
  const [toast, setToast] = useState<Toast | null>(null);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeSummary | null>(null);
  const [showSettings, setShowSettings] = useState(false);

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
    loadEmployeeDirectory().then((result) => {
      if (!result.success) {
        showToast('error', result.error ?? 'Could not load the employee directory.');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const [h, months] = await Promise.all([
        getHolidays(officeCode, year),
        getUploadedMonths(),
      ]);
      if (cancelled) return;
      setHolidays(h);
      let l: LeaveRecord[] = [];
      try {
        const monthKeysToFetch = months.length > 0 ? months.map((m) => m.key) : [selectedMonthKey];
        l = await getAllLeaveRecords(monthKeysToFetch);
        if (!cancelled) setLeaveRecords(l);
      } catch (err) {
        if (!cancelled) {
          setLeaveRecords([]);
          showToast('error', `Could not load leave data from the Leave Tracker: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
      const month = selectedMonthKey.split('_')[1];
      const sameMonth = months.filter(m => m.month === month && m.year === year);
      const officeRecs = (await Promise.all(sameMonth.map(m => getRecords(m.key)))).flat();
      if (cancelled) return;
      setAllOfficeRecords(officeRecs);

      // Fallback: some absent days may be marked in the Leave Tracker under
      // statuses not included in the monthly read. For any absent day that
      // wasn't returned in the initial monthly leave fetch, call the batch
      // lookup endpoint and merge results into the leaveRecords state.
      try {
        const missingItems: { employeeCode: string; date: string; officeCode: string }[] = [];
        const existingLeaves = Array.isArray(l) ? l : [];
        for (const r of officeRecs) {
          if (isAbsent(r.status)) {
            const found = existingLeaves.some(le => le.employeeCode === r.employeeCode && le.date === r.date);
            if (!found) missingItems.push({ employeeCode: r.employeeCode, date: r.date, officeCode: r.officeCode });
          }
        }
        if (missingItems.length > 0) {
          const lookup = await lookupLeavesForItems(missingItems);
          // merge deduplicated
          const merged = [...existingLeaves];
          for (const rec of lookup) {
            if (!merged.some(m => m.employeeCode === rec.employeeCode && m.date === rec.date)) merged.push(rec);
          }
          if (!cancelled) setLeaveRecords(merged);
        }
      } catch (err) {
        // failure of the fallback should not block the dashboard — log and continue
        console.warn('leave lookup batch failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedMonthKey]);

  // All records across every uploaded month — re-fetched whenever the set of
  // uploaded months changes. This is ALWAYS the source of truth; the month
  // dropdown only controls which holidays/leaves/office context to load.
  useEffect(() => {
    if (uploadedMonths.length === 0) { setAllUploadedRecords([]); return; }
    let cancelled = false;
    Promise.all(uploadedMonths.map(m => getRecords(m.key))).then(async (recs) => {
      if (cancelled) return;
      const flat = recs.flat();
      setAllUploadedRecords(flat);

      // Ensure leaves across all uploaded months are also loaded into leaveRecords
      try {
        const leaves = await getAllLeaveRecords(uploadedMonths.map(m => m.key));
        if (!cancelled && leaves.length > 0) {
          setLeaveRecords((prev) => {
            const existingKeys = new Set(prev.map(p => `${p.employeeCode}__${p.date}`));
            const merged = [...prev];
            for (const item of leaves) {
              const k = `${item.employeeCode}__${item.date}`;
              if (!existingKeys.has(k)) {
                existingKeys.add(k);
                merged.push(item);
              }
            }
            return merged;
          });
        }
      } catch (err) {
        console.warn('Failed to load leaves across all uploaded months:', err);
      }
    });
    return () => { cancelled = true; };
  }, [uploadedMonths]);

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

  useEffect(() => {
    (async () => {
      const months = await getUploadedMonths();
      if (months.length === 0) {
        // Genuinely empty deployment — no flash, this is the real state.
        setAppState('upload');
        return;
      }
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

    const queue: MappingQueueItem[] = [];
    const seen = new Set<string>();
    for (const pf of valid) {
      if (seen.has(pf.officeCode)) continue;
      seen.add(pf.officeCode);
      const existingMapping = await getMapping(pf.officeCode);
      const headers = await parseCSVHeaders(pf.file);
      if (!existingMapping) {
        queue.push({ officeCode: pf.officeCode, headers });
        continue;
      }
      // The office already has a saved mapping, but that mapping points to
      // specific header names from a PREVIOUS file. If this new file's
      // export format changed even slightly (renamed/reordered columns,
      // different machine/software version), every row[mapping.xxx] lookup
      // below silently returns undefined, so every row fails the
      // `!empCode || !date` check in parseCSVWithMapping and gets dropped —
      // resulting in a misleading "0 new, 0 updated" with no error at all.
      // Catch that here by verifying every mapped header still exists in
      // this file, and force a remap screen instead of a silent no-op.
      const missingHeaders = Object.values(existingMapping).filter(h => h && !headers.includes(h));
      if (missingHeaders.length > 0) {
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
    await saveMapping(current.officeCode, mapping);

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
      const mapping = await getMapping(pf.officeCode);
      if (!mapping) continue;
      const { records } = await parseCSVWithMapping(pf.file, mapping, pf.officeCode, thresholds.graceMinutes, thresholds.shortDayMinutes);
      if (records.length === 0) {
        // A non-empty CSV that parsed to zero rows almost always means the
        // saved column mapping no longer matches this file's headers (or
        // every row is missing an employee code / date). Surface this
        // loudly instead of silently reporting "0 new, 0 updated" as if
        // nothing was wrong.
        results.push(`${pf.officeCode} ${getMonthName(pf.month)} ${pf.year}: 0 rows parsed — check column mapping in Settings, the file's columns may not match what's expected.`);
        continue;
      }
      const monthKey = `${pf.year}_${pf.month}_${pf.officeCode}`;
      const monthLabel = `${pf.officeCode} \u2014 ${getMonthName(pf.month)} ${pf.year}`;
      // NOTE: uploaded_months row must exist BEFORE attendance_records rows,
      // since attendance_records.month_key has a foreign key referencing
      // uploaded_months.key. Creating it first avoids a 409/23503 FK violation.
      await addUploadedMonth({ key: monthKey, label: monthLabel, officeCode: pf.officeCode, month: pf.month, year: pf.year });
      const { added, updated, employeesCreated, employeesSyncError } = await saveRecords(monthKey, records);

      // Reconcile newly uploaded biometric attendance against already-approved
      // leave. This covers the case where leave was approved before the
      // attendance CSV arrived.
      try {
        const dates = records.map(r => r.date).filter(Boolean).sort();
        if (dates.length > 0) {
          const reconcileResponse = await fetch('/api/leave/attendance/reconcile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startDate: dates[0], endDate: dates[dates.length - 1] }),
          });
          if (!reconcileResponse.ok) {
            const body = await reconcileResponse.json().catch(() => ({}));
            console.warn('Leave/attendance reconciliation failed:', body.error ?? reconcileResponse.statusText);
          }
        }
      } catch (error) {
        console.warn('Leave/attendance reconciliation request failed:', error);
      }

      lastMonthKey = monthKey;
      let summary = `${pf.officeCode} ${getMonthName(pf.month)} ${pf.year} (${added} new, ${updated} updated)`;
      if (employeesCreated > 0) {
        summary += ` — ${employeesCreated} new employee${employeesCreated === 1 ? '' : 's'} onboarded to Leave Tracker`;
      }
      if (employeesSyncError) {
        summary += ` — WARNING: employee sync to Leave Tracker failed (${employeesSyncError})`;
      }
      results.push(summary);
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

  const isComparison = viewMode === 'comparison';

  // Comparison mode (2+ departments selected) needs the FULL department universe for dimmed comparison bars.
  // Only execute the universe calculation when isComparison is actually active.
  const comparisonData = useDashboardData(
    recordPool,
    selectedOffice,
    isComparison ? [] : selectedDepts,
    [],
    holidays,
    thresholds,
    leaveRecords,
    allOfficeRecords,
    dateFrom,
    dateTo
  );
  const allDeptAttendance = isComparison ? comparisonData.deptAttendance : deptAttendance;
  const allDeptRecords = isComparison ? comparisonData.filteredRecords : filteredRecords;

  const leaveMap = useMemo(() => buildLeaveMap(leaveRecords), [leaveRecords]);

  const currentOffice = getOfficeFromKey(selectedMonthKey);
  const currentYear = getYearFromKey(selectedMonthKey);

  // When the user hasn't picked an explicit From/To yet, derive it from filteredRecords
  const impliedRange = useMemo(() => {
    if (filteredRecords.length === 0) return null;
    let min = filteredRecords[0].date;
    let max = filteredRecords[0].date;
    for (let i = 1; i < filteredRecords.length; i++) {
      const d = filteredRecords[i].date;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return { min, max };
  }, [filteredRecords]);

  const effectiveDateFrom = dateFrom ?? impliedRange?.min ?? null;
  const effectiveDateTo = dateTo ?? impliedRange?.max ?? null;

  const filteredSummaries = useMemo(() => {
    if (tableFilter === 'all') return employeeSummaries;
    if (tableFilter === 'present') return employeeSummaries.filter(e => e.presentDays > 0);
    if (tableFilter === 'absent') return employeeSummaries.filter(e => e.absentDays > 0);
    if (tableFilter === 'late') return employeeSummaries.filter(e => e.lateCount > 0);
    if (tableFilter === 'earlyexit') return employeeSummaries.filter(e => e.earlyExitCount > 0);
    if (tableFilter === 'shortday') return employeeSummaries.filter(e => e.shortDayCount > 0);
    if (tableFilter === 'frequentpunch') return employeeSummaries.filter(e => e.frequentPunchDays > 0);
    return employeeSummaries;
  }, [tableFilter, employeeSummaries]);

  // All dates across ALL uploaded months, memoized with efficient set + sort
  const { allAvailableDates, minAvailableDate, maxAvailableDate } = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < allUploadedRecords.length; i++) {
      set.add(allUploadedRecords[i].date);
    }
    const sorted = Array.from(set).sort();
    return {
      allAvailableDates: sorted,
      minAvailableDate: sorted[0] || undefined,
      maxAvailableDate: sorted[sorted.length - 1] || undefined,
    };
  }, [allUploadedRecords]);

  // Steps the Single Day view to the previous/next date that actually has
  // uploaded data (skips weekends/gaps with no records rather than landing
  // on an empty day). Used by the DayDeptAttendanceChart/DayDeptLateChart/
  // DayDeptProductivityChart headers so a user can move through days
  // without leaving the chart card.
  const currentDayIndex = dateFrom ? allAvailableDates.indexOf(dateFrom) : -1;
  const canGoPrevDay = currentDayIndex > 0;
  const canGoNextDay = currentDayIndex >= 0 && currentDayIndex < allAvailableDates.length - 1;
  function stepDay(delta: number) {
    if (currentDayIndex < 0) return;
    const next = allAvailableDates[currentDayIndex + delta];
    if (!next) return;
    setDateFrom(next);
    setDateTo(next);
  }

  // Once there's actual uploaded data, the dashboard itself stays mounted
  // and visible even while Upload/Mapping are open — those become a modal
  // layered on top (same pattern as Settings/Holidays below), rather than
  // replacing the whole page. Only the genuine first-run empty state (no
  // data at all yet) still gets Upload as a full page, since there's no
  // dashboard behind it to show.
  const hasDashboardData = uploadedMonths.length > 0;

  // Nav sections only exist once there's an actual dashboard rendered —
  // before any data exists there's nothing to scroll to yet. The
  // Comparison panels only render outside single-day view (see below).
  const availableSections: DashboardSectionId[] = !hasDashboardData
    ? []
    : viewMode === 'single_day'
      ? ['overview', 'employees', 'departments']
      : ['overview', 'employees', 'departments', 'comparison'];

  return (
    <DashboardShell
      variant="hr"
      availableSections={availableSections}
      onSignOut={handleSignOut}
      holidayCount={holidays.length}
      onOpenHolidays={hasDashboardData && (holidays.length > 0 || !!currentOffice) ? () => setShowHolidayModal(true) : undefined}
      onOpenSettings={hasDashboardData ? () => setShowSettings(true) : undefined}
      onUpload={hasDashboardData ? () => setAppState('upload') : undefined}
      exportSlot={hasDashboardData ? <ExportPanel uploadedMonths={uploadedMonths} thresholds={thresholds} /> : undefined}
    >
      {toast && (
        <div className={`fixed top-4 right-4 left-4 sm:left-auto z-50 flex items-start gap-3 sm:max-w-md px-4 py-3 rounded-xl shadow-2xl border
          ${toast.type === 'success' ? 'bg-emerald-900/90 border-emerald-500/40 text-emerald-700 dark:text-emerald-200' : 'bg-red-900/90 border-red-500/40 text-red-700 dark:text-red-200'}`}>
          <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{toast.message}</p>
        </div>
      )}

      <div>
        {appState === 'loading' && (
          <div className="py-4">
            <DashboardSkeleton />
          </div>
        )}

        {/* True first-run empty state — no dashboard exists yet, so Upload
           renders full-page rather than as a modal (nothing to show behind it). */}
        {!hasDashboardData && appState === 'upload' && (
          <div className="space-y-6">
            <div className="text-[var(--text-muted)] text-xs">Upload one or more biometric export CSVs to get started</div>
            <UploadZone onFiles={handleFiles} />
          </div>
        )}
        {!hasDashboardData && appState === 'mapping' && mappingQueue.length > 0 && (
          <ColumnMappingScreen
            officeCode={mappingQueue[0].officeCode}
            csvHeaders={mappingQueue[0].headers}
            initialMapping={remapInitial}
            onSave={handleMappingSave}
            onCancel={() => { setMappingQueue([]); setPendingBatch([]); setRemapInitial(undefined); setAppState('upload'); }}
          />
        )}

        {hasDashboardData && (
          <div className="space-y-6">

            {/* ── Executive Dashboard Header & Control Strip ──────────────── */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 shadow-lg space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-2.5">
                    <span>Attendance Dashboard</span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Biometric Data
                    </span>
                  </h1>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    biometric analytics &amp; employee attendance tracking · <span className="font-semibold text-[var(--text-primary)]">{filteredRecords.length.toLocaleString()}</span> records
                  </p>
                </div>

                {/* Quick Range Presets */}
                {allAvailableDates.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => { setDateFrom(null); setDateTo(null); }}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${!dateFrom && !dateTo
                        ? 'bg-[var(--accent)] text-white shadow-sm font-semibold'
                        : 'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                    >
                      Default Month
                    </button>
                    <button
                      onClick={() => {
                        if (minAvailableDate && maxAvailableDate) {
                          setDateFrom(minAvailableDate);
                          setDateTo(maxAvailableDate);
                        }
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${dateFrom === minAvailableDate && dateTo === maxAvailableDate
                        ? 'bg-[var(--accent)] text-white shadow-sm font-semibold'
                        : 'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                    >
                      All Uploaded ({allAvailableDates.length}d)
                    </button>
                  </div>
                )}
              </div>

              {/* ── Filter Controls Row ────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Date range picker */}
                {allAvailableDates.length > 0 && (
                  <div className="flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-2 shadow-inner">
                    <Calendar className="w-4 h-4 text-[var(--accent)] flex-shrink-0" />
                    <span className="text-[var(--text-muted)] text-xs font-medium">From:</span>
                    <input
                      type="date"
                      value={dateFrom ?? impliedRange?.min ?? ''}
                      min={minAvailableDate}
                      max={effectiveDateTo ?? maxAvailableDate}
                      onChange={e => {
                        const v = e.target.value || null;
                        if (v && (v < minAvailableDate! || v > maxAvailableDate!)) {
                          showToast('error', `No data outside ${minAvailableDate} → ${maxAvailableDate}.`);
                          return;
                        }
                        setDateFrom(v);
                        if (v) setDateTo(effectiveDateTo ?? v);
                      }}
                      className={`bg-transparent text-xs font-medium focus:outline-none w-28 sm:w-32 ${dateFrom ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}
                      title={!dateFrom ? 'Auto-filled to match current month data' : undefined}
                    />
                    <span className="text-[var(--border)] text-xs font-bold">|</span>
                    <span className="text-[var(--text-muted)] text-xs font-medium">To:</span>
                    <input
                      type="date"
                      value={dateTo ?? impliedRange?.max ?? ''}
                      min={effectiveDateFrom ?? minAvailableDate}
                      max={maxAvailableDate}
                      onChange={e => {
                        const v = e.target.value || null;
                        if (v && (v < minAvailableDate! || v > maxAvailableDate!)) {
                          showToast('error', `No data outside ${minAvailableDate} → ${maxAvailableDate}.`);
                          return;
                        }
                        setDateTo(v);
                        if (v) setDateFrom(effectiveDateFrom ?? v);
                      }}
                      className={`bg-transparent text-xs font-medium focus:outline-none w-28 sm:w-32 ${dateTo ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}
                      title={!dateTo ? 'Auto-filled to match current month data' : undefined}
                    />
                    {(dateFrom || dateTo) && (
                      <button
                        onClick={() => { setDateFrom(null); setDateTo(null); }}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ml-1 p-0.5 rounded hover:bg-[var(--bg-elevated)]"
                        title="Clear date range"
                      >
                        <XIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Office pills */}
                <div className="flex items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-1 shadow-inner">
                  {['ALL', ...offices].map(o => (
                    <button
                      key={o}
                      onClick={() => handleOfficeChange(o)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${selectedOffice === o
                        ? 'bg-[var(--primary)] text-white shadow-sm'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                        }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>

                {/* Department pills rail */}
                <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-[200px]">
                  {departments.map(d => {
                    const isSelected = selectedDepts.includes(d);
                    return (
                      <button
                        key={d}
                        onClick={() => toggleDept(d)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${isSelected
                          ? 'bg-violet-600 text-white shadow-sm font-semibold'
                          : 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-violet-500/40'
                          }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                  {selectedDepts.length > 0 && (
                    <button
                      onClick={clearDepts}
                      className="px-2.5 py-1 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors font-medium underline"
                    >
                      Clear ({selectedDepts.length})
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* ── Active filter banner ───────────────────────────────────── */}
            {(dateFrom || dateTo) && (
              <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 border shadow-sm ${viewMode === 'single_day'
                ? 'bg-blue-500/10 border-blue-500/30'
                : 'bg-indigo-500/10 border-indigo-500/30'
                }`}>
                <Calendar className={`w-5 h-5 flex-shrink-0 ${viewMode === 'single_day' ? 'text-blue-500' : 'text-indigo-500'}`} />
                <div className="flex-1 min-w-0">
                  {viewMode === 'single_day' ? (
                    <span className="text-[var(--text-primary)] text-sm font-medium">
                      <strong className="text-blue-600 dark:text-blue-400">Single Day View:</strong> {new Date((dateFrom ?? '') + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      <span className="text-[var(--text-muted)] text-xs ml-2 font-normal">— Showing exact punch snapshots</span>
                    </span>
                  ) : (
                    <span className="text-[var(--text-primary)] text-sm font-medium">
                      <strong className="text-indigo-600 dark:text-indigo-400">Custom Date Range:</strong> {dateFrom} → {dateTo}
                      <span className="text-[var(--text-muted)] text-xs ml-2 font-normal">— {filteredRecords.length.toLocaleString()} attendance records</span>
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { setDateFrom(null); setDateTo(null); }}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0 p-1 rounded-lg hover:bg-[var(--bg-elevated)]"
                  title="Reset to default month"
                >
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* ── KPI Cards ──────────────────────────────────────────────── */}
            <div id="section-overview" className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Performance Metrics
                </h2>
                {tableFilter !== 'all' && (
                  <span className="text-xs text-[var(--accent)] font-medium">
                    Filtered by: <span className="font-semibold capitalize">{tableFilter}</span> (click card to clear)
                  </span>
                )}
              </div>
              <KPICards kpi={kpi} thresholds={thresholds} viewMode={viewMode} activeFilter={tableFilter} onCardClick={(f) => setTableFilter(f === tableFilter ? 'all' : f)} />
              {/* Pre-approved leave visibility card */}
              <OnLeaveTodayCard />
            </div>




            {/* ── SINGLE DAY VIEW ─────────────────────────────────────────── */}
            {viewMode === 'single_day' && (
              <>
                <div id="section-departments" className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                  <DayDeptAttendanceChart
                    data={dayDeptSnapshots}
                    onDeptClick={(dept) => focusDept(dept)}
                    allRecords={filteredRecords}
                    graceMinutes={thresholds.graceMinutes}
                    shiftStartMinutes={thresholds.shiftStartMinutes}
                    shiftEndMinutes={thresholds.shiftEndMinutes}
                    leaveMap={leaveMap}
                    date={dateFrom ?? undefined}
                    onPrevDay={() => stepDay(-1)}
                    onNextDay={() => stepDay(1)}
                    canGoPrev={canGoPrevDay}
                    canGoNext={canGoNextDay}
                  />
                  <DayDeptLateChart
                    data={dayDeptSnapshots}
                    onDeptClick={(dept) => focusDept(dept)}
                    allRecords={filteredRecords}
                    graceMinutes={thresholds.graceMinutes}
                    shiftStartMinutes={thresholds.shiftStartMinutes}
                    shiftEndMinutes={thresholds.shiftEndMinutes}
                    date={dateFrom ?? undefined}
                    onPrevDay={() => stepDay(-1)}
                    onNextDay={() => stepDay(1)}
                    canGoPrev={canGoPrevDay}
                    canGoNext={canGoNextDay}
                  />
                  <DayDeptProductivityChart
                    data={dayDeptSnapshots}
                    onDeptClick={(dept) => focusDept(dept)}
                    allRecords={filteredRecords}
                    shiftStartMinutes={thresholds.shiftStartMinutes}
                    shiftEndMinutes={thresholds.shiftEndMinutes}
                    date={dateFrom ?? undefined}
                    onPrevDay={() => stepDay(-1)}
                    onNextDay={() => stepDay(1)}
                    canGoPrev={canGoPrevDay}
                    canGoNext={canGoNextDay}
                  />
                </div>
                <div id="section-employees" className="bg-[var(--bg-elevated)]/30 rounded-xl border border-[var(--border)] p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                    <h2 className="text-[var(--text-primary)] font-semibold text-sm">
                      {selectedDepts.length === 1 ? `Team Members — ${selectedDepts[0]}` : `All Employees — ${dateFrom}`}
                      {tableFilter !== 'all' && (
                        <span className="ml-2 text-xs text-[var(--text-muted)] font-normal">
                          · filtered by <span className="text-blue-400 capitalize">{tableFilter}</span>
                          <button onClick={() => setTableFilter('all')} className="ml-2 text-[var(--text-muted)] hover:text-[var(--text-muted)]">✕</button>
                        </span>
                      )}
                      {selectedDepts.length === 1 && (
                        <button onClick={clearDepts} className="ml-2 text-[var(--text-muted)] hover:text-[var(--text-muted)]">✕</button>
                      )}
                    </h2>
                    <span className="text-[var(--text-muted)] text-xs">{filteredSummaries.length} employees</span>
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
                <div id="section-departments" className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
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
                    shiftStartMinutes={thresholds.shiftStartMinutes}
                    shiftEndMinutes={thresholds.shiftEndMinutes}
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
                    graceMinutes={thresholds.graceMinutes}
                    shiftStartMinutes={thresholds.shiftStartMinutes}
                    shiftEndMinutes={thresholds.shiftEndMinutes}
                    leaveMap={leaveMap}
                  />
                )}

                <div id="section-comparison" className="space-y-6">
                  {isComparison && departments.length >= 2 && (
                    <TeamComparisonPanel
                      allRecords={filteredRecords}
                      departments={departments}
                      holidays={holidays}
                      leaveRecords={leaveRecords}
                      graceMinutes={thresholds.graceMinutes}
                      shiftStartMinutes={thresholds.shiftStartMinutes}
                      shiftEndMinutes={thresholds.shiftEndMinutes}
                    />
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
                </div>
                <InsightsStrip summaries={employeeSummaries} dailyTrend={dailyTrend} deptAttendance={deptAttendance} records={filteredRecords} selectedDepts={selectedDepts} />
                <div id="section-employees" className="bg-[var(--bg-elevated)]/30 rounded-xl border border-[var(--border)] p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                    <h2 className="text-[var(--text-primary)] font-semibold text-sm">
                      Employee Summary
                      {tableFilter !== 'all' && (
                        <span className="ml-2 text-xs text-[var(--text-muted)] font-normal">
                          · filtered by <span className="text-blue-400 capitalize">{tableFilter}</span>
                          <button onClick={() => setTableFilter('all')} className="ml-2 text-[var(--text-muted)] hover:text-[var(--text-muted)]">✕</button>
                        </span>
                      )}
                    </h2>
                    <span className="text-[var(--text-muted)] text-xs">{filteredSummaries.length} employees</span>
                  </div>
                  <EmployeeTable summaries={filteredSummaries} onEmployeeClick={setSelectedEmp} />
                </div>
              </>
            )}
          </div>
        )}

        {/* Upload / Mapping as a modal over the existing dashboard, rather
           than replacing it — matches how Settings/Holidays already behave.
           Portaled to <body> so it can't get trapped inside the sidebar's
           own stacking context (the same bug that hit the Export dialog). */}
        {hasDashboardData && (appState === 'upload' || appState === 'mapping') && typeof document !== 'undefined' && createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setAppState('dashboard')}
          >
            <div
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-[var(--border)] flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[var(--text-primary)] font-semibold text-sm">
                    {appState === 'mapping' ? 'Map Columns' : 'Upload CSV'}
                  </h3>
                  {appState === 'upload' && (
                    <p className="text-[var(--text-muted)] text-xs mt-1">Upload one or more biometric export CSVs to add data.</p>
                  )}
                </div>
                <button
                  onClick={() => setAppState('dashboard')}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
                >
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
              <div className="scroll-thin px-5 py-4 overflow-y-auto">
                {appState === 'upload' && <UploadZone onFiles={handleFiles} />}
                {appState === 'mapping' && mappingQueue.length > 0 && (
                  <ColumnMappingScreen
                    officeCode={mappingQueue[0].officeCode}
                    csvHeaders={mappingQueue[0].headers}
                    initialMapping={remapInitial}
                    onSave={handleMappingSave}
                    onCancel={() => { setMappingQueue([]); setPendingBatch([]); setRemapInitial(undefined); setAppState('dashboard'); }}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>

      <EmployeePanel
        employee={selectedEmp}
        onClose={() => setSelectedEmp(null)}
        leaveReadOnly
        holidays={holidays}
        graceMinutes={thresholds.graceMinutes}
        shiftStartMinutes={thresholds.shiftStartMinutes}
        shiftEndMinutes={thresholds.shiftEndMinutes}
        monthKey={selectedMonthKey}
        leaveMap={leaveMap}
        allDepartments={getAllKnownDepartments(allUploadedRecords)}
        onDepartmentChange={refreshDepartmentOverrides}
        onToast={showToast}
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
          onToast={showToast}
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
    </DashboardShell>
  );
}

// Single-login pivot: this used to be the page's default export and
// decided everything itself from the URL (?view=1&token=... vs plain
// hit = HR). Now app/page.tsx (a Server Component) does the auth/role
// lookup first and hands the result down as props — `role` is null only
// for the legacy unauthenticated share-link case (?view=1&token=...,
// still handled entirely client-side below, unchanged); for every other
// hit, app/page.tsx has already confirmed the session and resolved the
// role (a plain `employee` never reaches here at all — redirected server-
// side to /leave/me before this component is ever rendered).
export default function DashboardClient({
  role,
  teamCodes,
  managedDepartments,
}: {
  role: 'hr' | 'manager' | 'lead' | null;
  teamCodes?: string[];
  managedDepartments?: string[];
}) {
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

    if (role === 'manager' || role === 'lead') {
      const codes = new Set(teamCodes ?? []);
      (async () => {
        const months = await getUploadedMonths();
        const all = (await Promise.all(months.map((m) => getRecords(m.key)))).flat();
        setManagerRecords(codes.size > 0 ? all.filter((r) => codes.has(r.employeeCode)) : []);
        setViewMode('team');
      })();
      return;
    }

    setViewMode('hr');
  }, [role, teamCodes]);

  if (viewMode === 'loading') return (
    <div className="min-h-screen bg-[var(--bg-surface)] p-6 md:p-8">
      <DashboardSkeleton />
    </div>
  );
  if (viewMode === 'denied') return (
    <div className="min-h-screen bg-[var(--bg-surface)] flex flex-col items-center justify-center gap-4">
      <ShieldX className="w-12 h-12 text-red-400" />
      <p className="text-[var(--text-muted)] text-sm">Access denied — shared link is invalid or expired.</p>
    </div>
  );
  if (viewMode === 'manager') return <ManagerView records={managerRecords} />;
  if (viewMode === 'team') return <ManagerView records={managerRecords} teamMode teamCodes={teamCodes} managedDepartments={managedDepartments} />;

  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg-surface)] p-6 md:p-8"><DashboardSkeleton /></div>}>
      <HRDashboard />
    </Suspense>
  );
}