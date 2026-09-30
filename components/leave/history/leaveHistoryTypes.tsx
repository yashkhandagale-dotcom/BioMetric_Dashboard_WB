import React from 'react';

export type LeaveHistoryRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  office: string;
  leaveTypeCode: string;
  leaveTypeLabel: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  halfDaySession: string | null;
  totalDays: number;
  status: string;
  isLwpOverride: boolean;
  appliedOn: string;
  recordedBy: string;
  correctedByName?: string | null;
  correctionReason?: string | null;
  consolidatedIds?: string[];
  isConsolidated?: boolean;
  constituentCount?: number;
};

export function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/25',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25',
  auto_lwp: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/25',
  cancelled: 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border)]',
};

export function statusLabel(status: string): string {
  if (status === 'auto_lwp') return 'Approved (LWP)';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function leaveTypeBadge(code: string, label: string) {
  const c = code.toUpperCase();
  let style = 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25';
  if (c === 'SL') style = 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25';
  else if (c === 'CL') style = 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25';
  else if (c === 'PL') style = 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25';
  else if (c === 'LWP') style = 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/25';

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1 border shadow-2xs ${style}`}>
      <span className="font-mono text-[10px] font-bold opacity-85">{code}</span>
      <span className="text-[var(--text-muted)]">·</span>
      <span className="truncate max-w-[120px]">{label}</span>
    </span>
  );
}

export function formatMonthHeader(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString('default', { month: 'long', year: 'numeric' });
}
