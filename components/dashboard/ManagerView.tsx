'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  AttendanceRecord,
  EmployeeSummary,
  UploadedMonth,
  Thresholds,
  LeaveRecord,
} from '@/lib/types';
import { getThresholds, DEFAULT_THRESHOLDS } from '@/lib/settings';
import { getUploadedMonths } from '@/lib/storage';
import { getAllLeaveRecords } from '@/lib/leaveTrackerRead';
import { buildLeaveMap, useDashboardData, targetShiftMinutes } from '@/lib/useDashboardData';
import DashboardShell from '@/components/dashboard/DashboardShell';
import KPICards from '@/components/KPICards';
import OnLeaveTodayCard from '@/components/OnLeaveTodayCard';
import EmployeeTable from '@/components/EmployeeTable';

// Lazy-loaded components for Manager view
const ExportPanel = dynamic(() => import('@/components/ExportPanel'), { ssr: false });
const EmployeePanel = dynamic(() => import('@/components/EmployeePanel'), { ssr: false });
const DailyTrendChart = dynamic(() => import('@/components/Charts').then((m) => ({ default: m.DailyTrendChart })), { ssr: false });
const DeptAttendanceChart = dynamic(() => import('@/components/Charts').then((m) => ({ default: m.DeptAttendanceChart })), { ssr: false });
const HoursDistributionChart = dynamic(() => import('@/components/Charts').then((m) => ({ default: m.HoursDistributionChart })), { ssr: false });

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

export interface ManagerViewProps {
  records: AttendanceRecord[];
  teamMode?: boolean;
  teamCodes?: string[];
  managedDepartments?: string[];
}

export default function ManagerView({
  records,
  teamMode,
  teamCodes,
  managedDepartments,
}: ManagerViewProps) {
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
          <EmployeeTable
            summaries={employeeSummaries}
            onEmployeeClick={setSelectedEmp}
            shiftTargetMins={targetShiftMinutes(thresholds.shiftStartMinutes, thresholds.shiftEndMinutes)}
            avgHoursPctGreen={thresholds.avgHoursPctGreen}
            avgHoursPctAmber={thresholds.avgHoursPctAmber}
          />
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
