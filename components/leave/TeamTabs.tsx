'use client';

import { useMemo, useState } from 'react';
import { CalendarCheck, Sparkles } from 'lucide-react';
import LeaveHistoryTable, { LeaveHistoryRow } from './LeaveHistoryTable';
import TeamRegulariseModal from './TeamRegulariseModal';
import { formatOrdinalDate } from '@/lib/dateFormat';

export type OnLeaveTodayRow = {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  startDate: string;
  leaveTypeLabel: string;
  isHalfDay: boolean;
  halfDaySession: string | null;
};

export type RegularisationRow = {
  id: string;
  employeeName: string;
  date: string;
  reason: string;
  regularisedByName: string;
  status: string;
};

export type RosterRow = {
  id: string;
  full_name: string;
  employee_code: string;
  department: string;
  office: string;
};

export type BalanceRow = {
  employeeId: string;
  SL: number;
  CL: number;
  PL: number;
  LWP: number;
};

const REGULARISATIONS_PAGE_SIZE = 8;
const ROSTER_PAGE_SIZE = 8;
const HISTORY_PAGE_SIZE = 10;

type TabId = 'today' | 'regularisations' | 'roster' | 'history';

// Deterministic department → color mapping (hashed from the name, not
// random) so the same department always renders the same tag color across
// reloads, letting a manager group a mixed-department roster visually
// instead of reading every row.
const DEPARTMENT_PALETTE = [
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/20',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/20',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/20',
  'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/20',
  'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/20',
  'bg-lime-500/15 text-lime-700 dark:text-lime-300 border-lime-500/20',
];

function departmentClass(department: string): string {
  let hash = 0;
  for (let i = 0; i < department.length; i++) {
    hash = (hash * 31 + department.charCodeAt(i)) >>> 0;
  }
  return DEPARTMENT_PALETTE[hash % DEPARTMENT_PALETTE.length];
}

function DepartmentTag({ department }: { department: string }) {
  return (
    <span className={`text-xs rounded-full px-2 py-0.5 border ${departmentClass(department)}`}>
      {department}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-[var(--text-muted)]">{message}</p>
    </div>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-64">
      <svg
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-8 pr-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
      />
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  if (totalItems === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between gap-3 pt-4 mt-1 border-t border-[var(--border)]">
      <p className="text-xs text-[var(--text-muted)]">
        {start}–{end} of {totalItems}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="text-xs font-medium rounded-md px-2.5 py-1.5 border border-[var(--border)] text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg-elevated)] transition-colors"
        >
          Prev
        </button>
        <span className="text-xs text-[var(--text-muted)] px-2 tabular-nums">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="text-xs font-medium rounded-md px-2.5 py-1.5 border border-[var(--border)] text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg-elevated)] transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  dot,
  label,
  count,
  onClick,
}: {
  active: boolean;
  dot?: 'emerald' | 'amber' | 'none';
  label: string;
  count: number;
  onClick: () => void;
}) {
  const dotClass = dot === 'emerald' ? 'bg-emerald-500' : dot === 'amber' ? 'bg-amber-500' : '';
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative shrink-0 flex items-center gap-2 px-1 pb-3 pt-1 text-sm font-medium whitespace-nowrap transition-colors ${
        active ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
      }`}
    >
      {dot && dot !== 'none' && <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />}
      {label}
      <span className="text-xs text-[var(--text-muted)] tabular-nums">{count}</span>
      {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[var(--accent)] rounded-full" aria-hidden />}
    </button>
  );
}

export default function TeamTabs({
  onLeaveToday,
  regularisations,
  reports,
  balances,
  history,
}: {
  onLeaveToday: OnLeaveTodayRow[];
  regularisations: RegularisationRow[];
  reports: RosterRow[];
  balances: BalanceRow[];
  history: LeaveHistoryRow[];
}) {
  const [tab, setTab] = useState<TabId>('today');
  const [teamRegModalOpen, setTeamRegModalOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<string>('all');

  const [regPage, setRegPage] = useState(1);

  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterPage, setRosterPage] = useState(1);

  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);

  const availableTeams = useMemo(() => {
    return Array.from(new Set(reports.map((r) => r.department).filter(Boolean))).sort();
  }, [reports]);

  const teamFilteredToday = useMemo(() => {
    if (selectedTeam === 'all') return onLeaveToday;
    return onLeaveToday.filter((r) => r.department === selectedTeam);
  }, [onLeaveToday, selectedTeam]);

  const teamFilteredReports = useMemo(() => {
    if (selectedTeam === 'all') return reports;
    return reports.filter((r) => r.department === selectedTeam);
  }, [reports, selectedTeam]);

  const teamFilteredHistory = useMemo(() => {
    if (selectedTeam === 'all') return history;
    return history.filter((r) => r.department === selectedTeam);
  }, [history, selectedTeam]);

  const filteredReports = useMemo(() => {
    const q = rosterSearch.trim().toLowerCase();
    if (!q) return teamFilteredReports;
    return teamFilteredReports.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.employee_code.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q)
    );
  }, [teamFilteredReports, rosterSearch]);

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return teamFilteredHistory;
    return teamFilteredHistory.filter(
      (r) =>
        r.employeeName.toLowerCase().includes(q) ||
        r.employeeCode.toLowerCase().includes(q) ||
        r.leaveTypeLabel.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
    );
  }, [teamFilteredHistory, historySearch]);

  const regTotalPages = Math.max(1, Math.ceil(regularisations.length / REGULARISATIONS_PAGE_SIZE));
  const regPageClamped = Math.min(regPage, regTotalPages);
  const regPageRows = regularisations.slice(
    (regPageClamped - 1) * REGULARISATIONS_PAGE_SIZE,
    regPageClamped * REGULARISATIONS_PAGE_SIZE
  );

  const rosterTotalPages = Math.max(1, Math.ceil(filteredReports.length / ROSTER_PAGE_SIZE));
  const rosterPageClamped = Math.min(rosterPage, rosterTotalPages);
  const rosterPageRows = filteredReports.slice(
    (rosterPageClamped - 1) * ROSTER_PAGE_SIZE,
    rosterPageClamped * ROSTER_PAGE_SIZE
  );

  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  const historyPageClamped = Math.min(historyPage, historyTotalPages);
  const historyPageRows = filteredHistory.slice(
    (historyPageClamped - 1) * HISTORY_PAGE_SIZE,
    historyPageClamped * HISTORY_PAGE_SIZE
  );

  return (
    <div className="space-y-4">
      {/* Team Filter selector when multiple teams exist */}
      {availableTeams.length > 1 && (
        <div className="flex items-center justify-between bg-[var(--bg-elevated)]/50 border border-[var(--border)] rounded-2xl px-4 py-2.5 shadow-xs">
          <div className="flex items-center gap-2">
            <label htmlFor="team-tab-select" className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
              Team Filter:
            </label>
            <select
              id="team-tab-select"
              value={selectedTeam}
              onChange={(e) => {
                setSelectedTeam(e.target.value);
                setRosterPage(1);
                setHistoryPage(1);
              }}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            >
              <option value="all">All Teams ({availableTeams.length})</option>
              {availableTeams.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {selectedTeam !== 'all' && (
            <button
              type="button"
              onClick={() => setSelectedTeam('all')}
              className="text-xs font-semibold text-[var(--accent)] hover:underline"
            >
              Show All Teams
            </button>
          )}
        </div>
      )}

      {/* Tab bar header + Action button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border)] pb-1 mb-5">
        <div role="tablist" className="flex items-center gap-6 overflow-x-auto">
          <TabButton active={tab === 'today'} dot="emerald" label="On Leave Today" count={teamFilteredToday.length} onClick={() => setTab('today')} />
          <TabButton
            active={tab === 'regularisations'}
            dot="amber"
            label="Recent Regularisations"
            count={regularisations.length}
            onClick={() => setTab('regularisations')}
          />
          <TabButton active={tab === 'roster'} label="Roster & Balances" count={teamFilteredReports.length} onClick={() => setTab('roster')} />
          <TabButton active={tab === 'history'} label="Team Leave History" count={teamFilteredHistory.length} onClick={() => setTab('history')} />
        </div>

        {/* Manager Action: Regularise Team Day */}
        {reports.length > 0 && (
          <button
            type="button"
            onClick={() => setTeamRegModalOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] hover:opacity-95 text-white text-xs font-bold shadow-md shadow-[var(--accent)]/25 shrink-0 mb-2 sm:mb-0 transition-all"
          >
            <CalendarCheck size={14} />
            Regularise Team Day
          </button>
        )}
      </div>

      <TeamRegulariseModal
        reports={reports}
        isOpen={teamRegModalOpen}
        onClose={() => setTeamRegModalOpen(false)}
      />

      <section
        className={
          tab === 'history'
            ? ''
            : 'bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm'
        }
      >
        {tab === 'today' && (
          <div role="tabpanel">
            {onLeaveToday.length === 0 ? (
              <EmptyState message="Nobody on your team is on approved leave today." />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {onLeaveToday.map((row) => (
                  <li key={`${row.employeeId}-${row.startDate}`} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{row.employeeName}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {row.employeeCode} · {row.department}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium rounded-full px-2.5 py-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                      {row.leaveTypeLabel}
                      {row.isHalfDay ? ` · ${row.halfDaySession ?? 'Half day'}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'regularisations' && (
          <div role="tabpanel">
            {regularisations.length === 0 ? (
              <EmptyState message="No regularisations recorded for your team yet." />
            ) : (
              <>
                <ul className="divide-y divide-[var(--border)]">
                  {regPageRows.map((row) => (
                    <li key={row.id} className="py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{row.employeeName}</p>
                        <p className="text-xs text-[var(--text-muted)] shrink-0 font-medium">{formatOrdinalDate(row.date)}</p>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {row.reason} <span className="text-[var(--text-muted)]/70">— by {row.regularisedByName}</span>
                      </p>
                    </li>
                  ))}
                </ul>
                <Pagination
                  page={regPageClamped}
                  totalPages={regTotalPages}
                  totalItems={regularisations.length}
                  pageSize={REGULARISATIONS_PAGE_SIZE}
                  onPageChange={setRegPage}
                />
              </>
            )}
          </div>
        )}

        {tab === 'roster' && (
          <div role="tabpanel">
            <div className="flex items-center justify-between gap-3 mb-4">
              <SearchInput
                value={rosterSearch}
                onChange={(v) => {
                  setRosterSearch(v);
                  setRosterPage(1);
                }}
                placeholder="Search name, code, or department…"
              />
            </div>

            {filteredReports.length === 0 ? (
              <EmptyState
                message={reports.length === 0 ? 'No team members found for you yet.' : 'No team members match your search.'}
              />
            ) : (
              <>
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead>
                      <tr className="text-left text-[var(--text-muted)] text-xs uppercase tracking-wide">
                        <th className="pb-2.5 pr-4 font-medium">Employee</th>
                        <th className="pb-2.5 pr-4 font-medium">Code</th>
                        <th className="pb-2.5 pr-4 font-medium">Department</th>
                        <th className="pb-2.5 pr-4 font-medium text-right">SL</th>
                        <th className="pb-2.5 pr-4 font-medium text-right">CL</th>
                        <th className="pb-2.5 pr-4 font-medium text-right">PL</th>
                        <th className="pb-2.5 font-medium text-right">LWP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rosterPageRows.map((r) => {
                        const b = balances.find((tb) => tb.employeeId === r.id);
                        const lwp = b ? b.LWP : 0;
                        return (
                          <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="py-3 pr-4 border-t border-[var(--border)] font-medium text-[var(--text-primary)]">
                              {r.full_name}
                            </td>
                            <td className="py-3 pr-4 border-t border-[var(--border)] text-[var(--text-muted)]">
                              {r.employee_code}
                            </td>
                            <td className="py-3 pr-4 border-t border-[var(--border)]">
                              <DepartmentTag department={r.department} />
                            </td>
                            <td className="py-3 pr-4 border-t border-[var(--border)] text-right tabular-nums text-[var(--text-muted)]">
                              {b ? b.SL.toFixed(1) : '—'}
                            </td>
                            <td className="py-3 pr-4 border-t border-[var(--border)] text-right tabular-nums text-[var(--text-muted)]">
                              {b ? b.CL.toFixed(1) : '—'}
                            </td>
                            <td className="py-3 pr-4 border-t border-[var(--border)] text-right tabular-nums text-[var(--text-muted)]">
                              {b ? b.PL.toFixed(1) : '—'}
                            </td>
                            <td className="py-3 border-t border-[var(--border)] text-right tabular-nums">
                              {b ? (
                                <span className={lwp > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-[var(--text-muted)]'}>
                                  {lwp.toFixed(1)}
                                </span>
                              ) : (
                                <span className="text-[var(--text-muted)]">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={rosterPageClamped}
                  totalPages={rosterTotalPages}
                  totalItems={filteredReports.length}
                  pageSize={ROSTER_PAGE_SIZE}
                  onPageChange={setRosterPage}
                />
              </>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div role="tabpanel">
            <div className="flex items-center justify-between gap-3 mb-4">
              <SearchInput
                value={historySearch}
                onChange={(v) => {
                  setHistorySearch(v);
                  setHistoryPage(1);
                }}
                placeholder="Search name, type, or status…"
              />
            </div>

            {filteredHistory.length === 0 ? (
              <EmptyState
                message={history.length === 0 ? 'No leave records for your team yet.' : 'No leave records match your search.'}
              />
            ) : (
              <>
                <LeaveHistoryTable rows={historyPageRows} />
                <Pagination
                  page={historyPageClamped}
                  totalPages={historyTotalPages}
                  totalItems={filteredHistory.length}
                  pageSize={HISTORY_PAGE_SIZE}
                  onPageChange={setHistoryPage}
                />
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}